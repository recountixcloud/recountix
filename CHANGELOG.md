# Changelog

## Rc.0.05 – 2026-09-15

Production-candidate release for the Recountix multi-business recovery platform.

### Added
- Business-type-neutral terminology and onboarding.
- Per-business encrypted offline backup history using IndexedDB.
- Password-protected portable `.rxbackup` export and validated merge-only restore.
- Backup record counts, file size, history deletion and automatic retry status.
- Automatic backup checks while the app is open and online.
- Advertisement management and secure maintenance controls.

### Security
- Deny-by-default RLS on every public business table.
- Server-validated sessions, tenant scope and role checks for browser RPCs.
- Bcrypt passwords and login rate limiting.
- Content Security Policy on all HTML entry points.
- Direct browser table access and permissive legacy SQL policies removed.
- CI regression checks for secrets, unsafe policies, CSP and direct table access.

### Fixed
- Mobile sidebar tap reliability and overlay behavior.
- Mobile form zoom, touch targets, table overflow and small-screen login scrolling.
- Business data isolation, user creation shop assignment and record editing.
- Maintenance mode enforcement and protected-page redirects.

### Verification
- Functional smoke tests completed.
- Invalid and expired session behavior verified.
- Offline/error handling paths verified.
- Security workflow and GitHub Pages deployment are release gates.

## 3.0.0 – Production SaaS
- Migrated the application to a modular Supabase multi-tenant architecture.

## 2.0.0 – Supabase Multi-Tenant
- Base multi-shop schema and Super Admin module.
