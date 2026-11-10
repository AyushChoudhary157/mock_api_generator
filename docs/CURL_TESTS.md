# Sample cURL tests

```bash
BASE=http://localhost:3000            # or https://your-domain
TOKEN=mat_$(openssl rand -hex 24)     # any mat_ + 48 hex chars; the browser UI generates the same
H="X-Owner-Token: $TOKEN"; J="Content-Type: application/json"
```

## Management API (`/api/manage`, needs `X-Owner-Token`)
```bash
# limits (public)
curl $BASE/api/manage/limits
# create project  -> note project.id
curl -X POST $BASE/api/manage/projects -H "$H" -H "$J" -d '{"name":"Shop"}'
PID=<project id>
# list projects (with resources + usage)
curl $BASE/api/manage/projects -H "$H"
# get / rename / set project-wide simulation defaults / delete
curl $BASE/api/manage/projects/$PID -H "$H"
curl -X PATCH $BASE/api/manage/projects/$PID -H "$H" -H "$J" -d '{"name":"Shop v2","settings":{"delay_ms":200}}'
curl -X DELETE $BASE/api/manage/projects/$PID -H "$H"
# create resource with 10 generated records
curl -X POST $BASE/api/manage/projects/$PID/resources -H "$H" -H "$J" -d '{"name":"users","count":10,"fields":[{"name":"name","type":"name"},{"name":"email","type":"email"},{"name":"age","type":"int","min":18,"max":60}]}'
RID=<resource id>
# list resources / get / update schema+settings / delete
curl $BASE/api/manage/projects/$PID/resources -H "$H"
curl $BASE/api/manage/projects/$PID/resources/$RID -H "$H"
curl -X PATCH $BASE/api/manage/projects/$PID/resources/$RID -H "$H" -H "$J" -d '{"settings":{"error_rate":20,"error_status":503,"headers":{"X-Env":"staging"},"status_codes":{"POST":202}}}'
curl -X DELETE $BASE/api/manage/projects/$PID/resources/$RID -H "$H"
# (re)generate data: replace=false appends; seed makes it deterministic
curl -X POST $BASE/api/manage/projects/$PID/resources/$RID/generate -H "$H" -H "$J" -d '{"count":25,"replace":true,"seed":"demo"}'
# records via management API (do not count toward the public quota)
curl "$BASE/api/manage/projects/$PID/resources/$RID/records?page=1&limit=5" -H "$H"
curl -X POST $BASE/api/manage/projects/$PID/resources/$RID/records -H "$H" -H "$J" -d '{"name":"Ada","age":36}'
curl -X PUT  $BASE/api/manage/projects/$PID/resources/$RID/records/1 -H "$H" -H "$J" -d '{"name":"Ada L."}'
curl -X DELETE $BASE/api/manage/projects/$PID/resources/$RID/records/1 -H "$H"
# apply a multi-resource schema (parents are created first automatically)
curl -X POST $BASE/api/manage/projects/$PID/apply-schema -H "$H" -H "$J" -d '{"resources":[{"name":"posts","count":8,"fields":[{"name":"userId","type":"ref","ref":"users"},{"name":"title","type":"string"}]}]}'
# import (schema inferred) / export / logs
curl -X POST $BASE/api/manage/projects/$PID/import -H "$H" -H "$J" -d '{"resources":[{"name":"people","records":[{"name":"A","age":1},{"name":"B","age":2}]}],"replace":true}'
curl $BASE/api/manage/projects/$PID/export -H "$H"
curl $BASE/api/manage/projects/$PID/logs -H "$H"
# AI: describe your API (returns a validated proposal; 503 + fallback:"manual" if AI is unavailable)
curl -X POST $BASE/api/manage/projects/$PID/ai/schema -H "$H" -H "$J" -d '{"prompt":"e-commerce with users, products and orders"}'
```

## Public mock API (`/api/v1`, no auth, CORS open)
```bash
API=$BASE/api/v1/$PID
curl "$API"                                         # lists endpoints
curl "$API/users"                                   # list
curl -i "$API/users?page=2&limit=5&sortBy=age&order=desc"   # see X-Total-Count, Link headers
curl "$API/users?age=30&search=ada&envelope=true"   # filter + search + envelope
curl "$API/users/1"                                 # get one
curl -X POST  $API/users -H "$J" -d '{"name":"Grace","email":"g@example.com","age":45}'
curl -X PUT   $API/users/1 -H "$J" -d '{"name":"Grace H.","email":"g@example.com","age":46}'
curl -X PATCH $API/users/1 -H "$J" -d '{"age":47}'
curl -X DELETE $API/users/1
curl "$API/users/2/posts"                           # one-to-many (posts has a ref field to users)
curl -X POST $API/users/2/posts -H "$J" -d '{"title":"Hello"}'
curl -i -X OPTIONS $API/users -H "Origin: https://example.org" -H "Access-Control-Request-Method: POST"
# expected failures
curl -i -X POST $API/users -H "Content-Type: text/plain" -d x      # 415
curl -i -X POST $API/users -H "$J" -d '{"age":"old"}'              # 400 validation_error
curl -i $API/nope                                                  # 404
```

## Cron
```bash
curl -H "Authorization: Bearer $CRON_SECRET" $BASE/api/cron/cleanup
```
