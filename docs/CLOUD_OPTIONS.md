# Cloud Hosting Options (Always-On + Low Cost)

Last checked: 2026-02-14

## Requirements for this app
- Runs Docker Compose services continuously (`schoology`, `telegram-agent`).
- Supports Playwright/Chromium scrape jobs reliably (recommend >=2 GB RAM).
- Persistent disk for `data/` (`agent.db`, `storage.json`, `state.json`).
- Cheap monthly baseline, predictable spend.

## Shortlist
1. Hetzner Cloud VPS (best cost/performance)
   - Published low-end pricing includes small VPS plans around EUR 3.49/month.
   - Best fit when we want lowest ongoing cost with full Docker control.
   - Tradeoff: more DIY ops than managed PaaS.
   - Source: https://www.hetzner.com/cloud/

2. DigitalOcean Droplet (simple + predictable)
   - Basic Droplet pricing starts at around $4/month; higher RAM plans are straightforward.
   - Practical target for this app: 2 GB tier for Playwright headroom.
   - Tradeoff: higher cost than Hetzner for comparable resources.
   - Source: https://www.digitalocean.com/pricing/droplets

3. AWS Lightsail (predictable, AWS ecosystem)
   - Entry plans start around $3.50-$5/month depending on bundle/region details.
   - Good if we want AWS-native path later.
   - Tradeoff: value-per-dollar is usually weaker than Hetzner/DO at small sizes.
   - Source: https://aws.amazon.com/lightsail/pricing/

4. Railway (easy deploy, usage-based)
   - Hobby has a $5 monthly baseline and metered resource pricing.
   - Good developer experience; less infra work.
   - Tradeoff: long-running always-on containers can cost more than small VPS.
   - Source: https://docs.railway.com/reference/pricing/plans

5. Oracle Cloud Always Free (near-zero cost path)
   - Always Free includes Arm Ampere resources in supported regions.
   - Cost can be near $0 if capacity is available.
   - Tradeoff: capacity/quotas/availability can be inconsistent; higher operational friction.
   - Source: https://www.oracle.com/cloud/free/

## Recommendation
Pick one of these two:
1. Cost-first: Hetzner Cloud small VPS (recommended default).
2. Convenience-first: DigitalOcean Droplet (2 GB).

## Decision checklist
- Monthly budget target (e.g., <$10, <$15).
- Region preference (US East vs EU).
- Ops tolerance (DIY host hardening/backups vs convenience).
- Whether we need cloud-provider managed backups from day one.
