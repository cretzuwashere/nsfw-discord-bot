#!/usr/bin/env bash
# Verify every admin page route responds (302 redirect to login = healthy,
# i.e. the route exists and didn't 500). Run inside the container.
pages="dashboard modules audio announcements cards welcome role-menus birthdays reminders scheduled-messages moderation automod custom-commands guilds audit-logs permissions settings"
fail=0
for p in $pages; do
  code=$(curl -s -o /dev/null -w "%{http_code}" "http://admin:3000/$p")
  echo "$p: $code"
  if [ "$code" = "500" ] || [ "$code" = "404" ]; then fail=1; fi
done
exit $fail
