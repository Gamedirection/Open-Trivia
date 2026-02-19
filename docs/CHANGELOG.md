# Changelog / Roadmap

## Production Checklist
- [ ] Confirm `JWT_SECRET` set to a strong value
- [ ] Set `APP_URL` to the public domain
- [ ] Configure SMTP (or disable)
- [ ] Enable HTTPS and HSTS on the edge proxy
- [ ] Ensure DB persistence is configured
- [ ] Set resource limits/requests (CPU/RAM) in k8s/Swarm
- [ ] Run backups and verify restore
- [ ] Confirm service worker cache invalidation on release
- [ ] Monitor logs and alerts (error rates, latency, DB size)

## Roadmap
- [ ] Anti‑cheat checks for timer‑based scoring
- [ ] Image/video support on questions
- [ ] Governance workflow for category creation
- [ ] CSV export filters and PII redaction options
- [ ] Swagger UI hosted at `/docs`
