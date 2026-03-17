# Payment Service Troubleshooting Guide

## Service Details
- **App**: `deploy-health-demo` (Azure Container App)
- **Resource Group**: `rg-deploy-health-demo`
- **Subscription**: `3eaf90b4-f4fa-416e-a0aa-ac2321d9decb`
- **FQDN**: `deploy-health-demo.jollyriver-a5cec44d.eastus2.azurecontainerapps.io`
- **App Insights**: `deploy-health-demo-insights`
- **Endpoints**: `GET /health`, `GET /api/orders`, `POST /api/payments`

---

## Step 0: Query Telemetry for Error Details

Before investigating code or infrastructure, check telemetry to understand the failure pattern.

### Application Insights (KQL)
```kql
// Error rate by endpoint (last 1h, 5-minute buckets)
requests
| where timestamp > ago(1h)
| summarize total=count(), failed=countif(success == false),
    errorRate=round(100.0*countif(success == false)/count(), 2)
  by bin(timestamp, 5m), name, resultCode
| where failed > 0
| order by timestamp asc
```

```kql
// Exceptions with stack traces
exceptions
| where timestamp > ago(1h)
| project timestamp, type, outerMessage, innermostMessage, method
| take 20
```

### Dynatrace
- Check for active Davis problems: query problems with status=ACTIVE
- Search for spans on `http.route` containing "payments"
- Check error logs filtered by payment service or api/payments

**What to look for**: Which endpoint is failing? What HTTP status codes? Are there exceptions? Is the error rate sustained or a brief spike?

---

## Step 1: Check Payment Gateway Connectivity

Verify the service is reachable and responding:

```bash
# Health check
curl -s https://deploy-health-demo.jollyriver-a5cec44d.eastus2.azurecontainerapps.io/health

# Payment endpoint test (expect 200 with paymentId)
curl -s -X POST https://deploy-health-demo.jollyriver-a5cec44d.eastus2.azurecontainerapps.io/api/payments \
  -H "Content-Type: application/json" \
  -d '{"amount": 99.99}'
```

**Expected healthy response** (health):
```json
{"status":"ok","timestamp":"..."}
```

**Expected healthy response** (payments):
```json
{"paymentId":"pay_...","status":"processed","amount":99.99}
```

If the endpoint returns HTTP 500 or times out, proceed to Steps 2-3. If it returns 200, the issue may have self-resolved — confirm with Step 6.

---

## Step 2: Verify API Key Configuration

> **Note**: The current demo app (`server.js`) does not use API keys or external payment gateway credentials. This step applies if external payment provider integration is added in the future.

Check environment variables and app settings:
```bash
az containerapp show -g rg-deploy-health-demo -n deploy-health-demo \
  --subscription 3eaf90b4-f4fa-416e-a0aa-ac2321d9decb \
  --query "properties.template.containers[0].env" -o json
```

Verify all required secrets are set and not expired if external integrations exist.

---

## Step 3: Check Retry Logic for Transient Errors

Review the application code for proper error handling:

### What to look for in `server.js`:
- **try/catch blocks** around external HTTP calls (e.g., payment gateway requests)
- **Exponential backoff** pattern for retries (e.g., using `axios-retry` or custom retry logic)
- **Timeout handling** — are timeouts caught and retried vs. bubbling up as 500s?
- **Circuit breaker** pattern for persistent upstream failures

### Current state (as of 2026-03-17):
The `/api/payments` endpoint in `server.js` has **no retry logic and no external calls**. It simulates processing with a 50-150ms delay. If external integrations are added, retry logic should be implemented.

### How to test retry behavior:
```bash
# Send multiple rapid requests to check for transient failures
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://deploy-health-demo.jollyriver-a5cec44d.eastus2.azurecontainerapps.io/api/payments \
    -H "Content-Type: application/json" -d '{"amount": 10}')
  echo "Request $i: $STATUS"
done
```

---

## Step 4: Review Recent Deployments

Check for code changes that may have introduced errors:

```bash
# Check Container App revision history
az containerapp revision list -g rg-deploy-health-demo -n deploy-health-demo \
  --subscription 3eaf90b4-f4fa-416e-a0aa-ac2321d9decb \
  --query "[].{name:name, active:properties.active, created:properties.createdTime, state:properties.runningState, health:properties.healthState}" -o table

# Check Azure Activity Log for recent management operations
az monitor activity-log list --resource-group rg-deploy-health-demo \
  --subscription 3eaf90b4-f4fa-416e-a0aa-ac2321d9decb \
  --start-time $(date -u -d '24 hours ago' +%Y-%m-%dT%H:%M:%SZ) \
  --query "[].{time:eventTimestamp, operation:operationName.localizedValue, status:status.localizedValue}" -o table

# Check git history for recent code changes
cd <repo-root> && git log --oneline -10
```

If a bad deployment is found, consider rolling back to the previous healthy revision:
```bash
az containerapp revision activate -g rg-deploy-health-demo \
  --revision <previous-healthy-revision> \
  --subscription 3eaf90b4-f4fa-416e-a0aa-ac2321d9decb
```

---

## Step 5: Failover to Backup Payment Processor

> **Current state (as of 2026-03-17)**: No backup payment processor is configured for this demo service. This step is a placeholder for production readiness.

### TODO: To set up a backup processor:
1. Deploy a secondary Container App with the same image in a different region
2. Configure Azure Front Door or Traffic Manager for automatic failover
3. Set health probe on `/health` endpoint
4. Define failover threshold (e.g., >5% error rate for 5 minutes)

If a backup exists, switch traffic:
```bash
# Example: Update traffic split to route to backup
az containerapp ingress traffic set -g rg-deploy-health-demo -n deploy-health-demo \
  --subscription 3eaf90b4-f4fa-416e-a0aa-ac2321d9decb \
  --revision-weight <backup-revision>=100
```

---

## Step 6: Validate Recovery

After investigation or remediation, confirm the service is healthy:

```bash
# Run 20 test requests and check for failures
SUCCESS=0; FAIL=0
for i in $(seq 1 20); do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST \
    https://deploy-health-demo.jollyriver-a5cec44d.eastus2.azurecontainerapps.io/api/payments \
    -H "Content-Type: application/json" -d '{"amount": 10}')
  if [ "$STATUS" = "200" ]; then SUCCESS=$((SUCCESS+1)); else FAIL=$((FAIL+1)); fi
done
echo "Results: $SUCCESS success, $FAIL failed out of 20 requests"
```

### Confirm in App Insights:
```kql
requests
| where timestamp > ago(15m)
| summarize total=count(), failed=countif(success == false)
| extend errorRate=round(100.0*failed/total, 2)
```

**Criteria for resolution**: Error rate < 1% over 15 minutes, all test requests return 200.

---

## Past Incidents

### 2026-03-17: Error Rate Spike (PagerDuty Q0WLMWHTQPGNIT)
- **Symptoms**: 23 failed requests in 5-minute burst (10:05-10:15 UTC)
- **Root cause**: Transient platform-level issue (self-resolved)
- **Resolution**: No action needed; service recovered automatically
- **Lesson**: Individual App Insights event data expires quickly — check telemetry within 1-2 hours of the spike for detailed analysis
