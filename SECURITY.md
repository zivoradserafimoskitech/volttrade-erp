# Security model — VoltTrade ERP

## Access control (RLS)

Two classes of authenticated user:

- **Staff** — any user with at least one `app_role` (admin, management,
  trader, supply_manager, billing_officer, finance, risk_officer,
  operations, auditor). Detected by `is_staff()`. This is a back office:
  staff see all business records; specific writes are role-gated.
- **Portal consumers** — authenticated users with NO role, linked to a
  client via `clients.portal_user_id`. They see ONLY their own client and
  its metering points, readings and invoices. They can never read internal
  tables (balancing, prices, other clients).

`authenticated` alone grants nothing on internal tables — authorization
requires a role. Fixed the earlier `USING(true)` policies that let any
logged-in user (including portal consumers) read balancing, prices,
forecasts and settlements.

### Write gates by domain
- Market/price data: admin, trader, management
- Balancing (groups, schedules, PV): admin, management, supply_manager, trader, operations
- Settlement: + risk_officer
- Clients/metering points: supply_manager, operations, admin, management (delete: admin/management only)
- Invoices: billing_officer, finance, admin, management

### Assigning roles
Insert into `user_roles(user_id, role)`. A new staff member with no row
is treated as a portal consumer and blocked from internal data — assign a
role immediately after creating the account.

## Known open items (tracked, prioritised)
1. Kimi API (:3000) has no authentication — add Bearer middleware before exposing.
2. Kimi gateways share one MQTT credential — move to per-device (mTLS) as the fleet grows.
3. Timescale/MySQL ports open to internet — restrict by source IP.
4. TLS on 8883 is self-signed — issue a real cert for gateway verification.
5. Audit `verify_jwt` on all edge functions handling writes.
