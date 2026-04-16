# Security Vulnerabilities Report

**Generated:** 2026-01-18
**Source:** GitHub Dependabot
**Repository:** cdcent/agentic

## Summary

GitHub has identified **75 vulnerabilities** in the repository's dependencies.

### Severity Breakdown

| Severity | Count |
|----------|-------|
| Critical | 4     |
| High     | 33    |
| Moderate | 27    |
| Low      | 11    |
| **Total**| **75**|

## Action Items

Per deployment instructions, these vulnerabilities are documented but NOT being addressed at this time.

### Reasons for Deferral

1. **Deployment Priority** - Focus is on getting AKS deployment operational
2. **Dependency Complexity** - Many vulnerabilities are in transitive dependencies
3. **Testing Required** - Upgrades may introduce breaking changes requiring extensive testing

### Recommended Follow-up

After successful deployment:
1. Review critical vulnerabilities first
2. Create maintenance window for dependency updates
3. Test thoroughly in DEV before promoting to STG
4. Consider using Dependabot PRs for automated updates

## Links

- View full report: https://github.com/cdcent/agentic/security/dependabot
- GitHub Security Overview: https://github.com/cdcent/agentic/security

---
*This report was auto-generated during CDC AKS deployment.*
