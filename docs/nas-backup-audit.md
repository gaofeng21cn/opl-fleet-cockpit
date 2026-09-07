# NAS Backup Audit

Hyper Backup belongs to NAS operations. It is independent of Gateway deployment
acceptance. The optional `ops/synology/opl-nas-audit` command provides restricted,
read-only host evidence without granting general Docker or administrator access.

Review the installer policy and stage these two matching files together:

```text
opl-nas-audit
install-nas-audit-command.sh
```

From that directory, an authorized administrator installs once:

```bash
sudo /bin/sh ./install-nas-audit-command.sh
```

Then the configured ordinary SSH account can read:

```bash
sudo -n /usr/local/sbin/opl-nas-audit status | jq .
```

The command calls read-only Hyper Backup task APIs and reports task counts,
result counts, latest recorded success and NAS boot time. It omits task names,
users, destinations, paths, logs and credentials.

No configured task or no successful run yields `attentionRequired=true` and
a null success time. That is not a successful backup. This command never
triggers, configures, suspends or deletes a backup task.
