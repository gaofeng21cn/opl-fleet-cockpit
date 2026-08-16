#!/usr/bin/env python3
"""Scan tracked source and Git history without printing matched values."""

from __future__ import annotations

import argparse
import ipaddress
import re
import subprocess
import sys
from pathlib import Path


MAX_TEXT_BYTES = 8 * 1024 * 1024
SECRET_PATTERNS = {
    "private_key": re.compile(rb"-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----"),
    "github_token": re.compile(rb"\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{30,})\b"),
    "openai_api_key": re.compile(rb"\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b"),
    "aws_access_key": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    "google_api_key": re.compile(rb"\bAIza[0-9A-Za-z_-]{30,}\b"),
    "slack_token": re.compile(rb"\bxox[baprs]-[0-9A-Za-z-]{20,}\b"),
    "credentialed_url": re.compile(
        rb"\b[a-z][a-z0-9+.-]{1,20}://[^/\s:@]+:[^/\s@]+@[^/\s]+",
        re.IGNORECASE,
    ),
}
SECRET_ASSIGNMENT = re.compile(
    rb"""(?mx)
    ^\s*(?:export\s+)?
    [A-Z][A-Z0-9_]*(?:TOKEN|PASSWORD|PASSWD|SECRET|API_KEY|PRIVATE_KEY)[A-Z0-9_]*
    \s*[:=]\s*
    (?P<value>[^\r\n#]+)
    """
)
MAC_USER_SEGMENT = rb"""(?!example(?:/|$)|user(?:/|$)|runner(?:/|$))[^/\s"']+/"""
WINDOWS_USER_SEGMENT = rb"""(?!example(?:\\|$)|user(?:\\|$))[^\\\s"']+\\"""
ABSOLUTE_HOME = re.compile(
    b"(?:"
    + re.escape(b"/" + b"Users/")
    + MAC_USER_SEGMENT
    + b"|"
    + re.escape(b"/" + b"home/")
    + MAC_USER_SEGMENT
    + b"|[A-Za-z]:"
    + re.escape(b"\\" + b"Users\\")
    + WINDOWS_USER_SEGMENT
    + b")"
)
PERSONAL_SITE_LABEL = re.compile(
    rb"""(?ix)
    (?:\bname\b|\bsiteName\b|\bSITE_NAME\b)
    \s*[:=]\s*
    ["'](?!Ambient\ Ops|Example|Test)[A-Za-z][A-Za-z ._-]{1,60}\ Home["']
    """
)
PLIST_LITERAL_RULES = {
    "android_device_serial": re.compile(
        rb"<key>ANDROID_SERIAL</key>\s*<string>(?!__ANDROID_SERIAL__</string>|</string>)[^<]+</string>"
    ),
    "keychain_account": re.compile(
        rb"<key>(?:KEYCHAIN_ACCOUNT|OPL_FLEET_AGENT_KEYCHAIN_ACCOUNT)</key>\s*"
        rb"<string>(?!__KEYCHAIN_ACCOUNT__</string>)[^<]+</string>"
    ),
    "machine_identity": re.compile(
        rb"<key>OPL_FLEET_AGENT_MACHINE_(?:ID|NAME)</key>\s*"
        rb"<string>(?!__MACHINE_(?:ID|NAME)__</string>)[^<]+</string>"
    ),
    "snmp_user": re.compile(
        rb"<key>UNIFI_SNMP_USER</key>\s*<string>(?!__SNMP_USER__</string>|</string>)[^<]+</string>"
    ),
}
PLACEHOLDER_MARKERS = (
    b"${",
    b"$(",
    b"process.env",
    b"system.getenv",
    b"/run/secrets/",
    b"keychain",
    b"placeholder",
    b"example",
    b"dummy",
    b"test",
    b"change-me",
    b"changeme",
    b"replace-me",
    b"replace-",
    b"<",
    b"__",
)


def git(*args: str) -> bytes:
    return subprocess.check_output(["git", *args], stderr=subprocess.DEVNULL)


def tracked_paths() -> list[str]:
    output = git("ls-files", "-z", "--cached", "--others", "--exclude-standard")
    return [item.decode("utf-8", "surrogateescape") for item in output.split(b"\0") if item]


def history_commits() -> list[str]:
    output = git("rev-list", "--remotes=origin", "HEAD")
    return [line.decode("ascii") for line in output.splitlines() if line]


def history_paths(commit: str) -> list[str]:
    output = git("ls-tree", "-rz", "--name-only", commit)
    return [item.decode("utf-8", "surrogateescape") for item in output.split(b"\0") if item]


def is_text(data: bytes) -> bool:
    return len(data) <= MAX_TEXT_BYTES and b"\0" not in data


def placeholder_assignment(value: bytes) -> bool:
    normalized = value.strip().strip(b"'\"").lower()
    if not normalized or normalized in {b"...", b"null", b"none", b"false"}:
        return True
    if normalized.startswith(b"$"):
        return True
    word_characters = sum(
        byte == ord("_") or chr(byte).isalpha()
        for byte in normalized
    )
    if (
        b"_" in normalized
        and not any(chr(byte).isdigit() for byte in normalized)
        and word_characters >= len(normalized) - 1
    ):
        return True
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def private_ipv4(data: bytes) -> bool:
    private_ranges = (
        ipaddress.ip_network((167_772_160, 8)),
        ipaddress.ip_network((2_886_729_728, 12)),
        ipaddress.ip_network((3_232_235_520, 16)),
    )
    for match in re.finditer(rb"(?<![0-9.])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9.])", data):
        try:
            address = ipaddress.ip_address(match.group().decode("ascii"))
            if any(address in network for network in private_ranges):
                return True
        except ValueError:
            continue
    return False


def findings(path: str, data: bytes) -> tuple[set[str], set[str]]:
    blockers: set[str] = set()
    review: set[str] = set()
    if not is_text(data):
        return blockers, review

    for category, pattern in SECRET_PATTERNS.items():
        if pattern.search(data):
            blockers.add(category)
    for match in SECRET_ASSIGNMENT.finditer(data):
        if not placeholder_assignment(match.group("value")):
            blockers.add("literal_secret_assignment")

    if ABSOLUTE_HOME.search(data):
        review.add("absolute_user_home")
    if PERSONAL_SITE_LABEL.search(data):
        review.add("personal_site_label")
    if private_ipv4(data):
        review.add("private_ipv4")
    if path.startswith("ops/macos/"):
        for category, pattern in PLIST_LITERAL_RULES.items():
            if pattern.search(data):
                blockers.add(category)
    return blockers, review


def scan_current() -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    blockers: dict[str, set[str]] = {}
    review: dict[str, set[str]] = {}
    for path in tracked_paths():
        source = Path(path)
        if not source.is_file():
            continue
        add_findings(path, source.read_bytes(), blockers, review)
    return blockers, review


def scan_history(commits: list[str]) -> tuple[dict[str, set[str]], dict[str, set[str]]]:
    blockers: dict[str, set[str]] = {}
    review: dict[str, set[str]] = {}
    for commit in commits:
        for path in history_paths(commit):
            try:
                data = git("show", f"{commit}:{path}")
            except subprocess.CalledProcessError:
                continue
            add_findings(path, data, blockers, review)
    for category in PLIST_LITERAL_RULES:
        paths = blockers.pop(category, set())
        if paths:
            review.setdefault(category, set()).update(paths)
    return blockers, review


def add_findings(
    path: str,
    data: bytes,
    blockers: dict[str, set[str]],
    review: dict[str, set[str]],
) -> None:
    path_blockers, path_review = findings(path, data)
    for category in path_blockers:
        blockers.setdefault(category, set()).add(path)
    for category in path_review:
        review.setdefault(category, set()).add(path)


def print_findings(scope: str, severity: str, grouped: dict[str, set[str]]) -> None:
    for category in sorted(grouped):
        for path in sorted(grouped[category]):
            print(f"{scope}\t{severity}\t{category}\t{path}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--current", action="store_true", help="scan the current tracked tree")
    parser.add_argument("--history", action="store_true", help="scan origin refs plus HEAD")
    args = parser.parse_args()
    if not args.current and not args.history:
        args.current = args.history = True

    blocked = False
    if args.current:
        blockers, review = scan_current()
        print_findings("current", "block", blockers)
        print_findings("current", "review", review)
        print(f"current_summary\tblock_categories={len(blockers)}\treview_categories={len(review)}")
        blocked = blocked or bool(blockers)

    if args.history:
        commits = history_commits()
        blockers, review = scan_history(commits)
        print_findings("history", "block", blockers)
        print_findings("history", "review", review)
        print(
            f"history_summary\tcommits={len(commits)}\t"
            f"block_categories={len(blockers)}\treview_categories={len(review)}"
        )
        blocked = blocked or bool(blockers)

    print("public_readiness\tblocked" if blocked else "public_readiness\tpass_with_review")
    return 1 if blocked else 0


if __name__ == "__main__":
    sys.exit(main())
