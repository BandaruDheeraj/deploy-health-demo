# Deploy Health Demo

A simple Node.js Express API used to demonstrate the Azure SRE Agent's deployment health validation capabilities.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check — always returns 200 OK |
| `/api/orders` | GET | Returns order data |
| `/api/payments` | POST | Processes a payment |

## Running Locally

```bash
npm install
npm start
```

## Deployment

Deployed to Azure Container Apps via GitHub Actions on push to `main`.
Telemetry flows to Application Insights for Kusto-based health analysis.
