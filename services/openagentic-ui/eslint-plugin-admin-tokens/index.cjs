/**
 * eslint-plugin-admin-tokens
 *
 * Local ESLint plugin enforcing admin-portal token consistency.
 *
 * Currently exposes a single rule:
 *   - no-hardcoded-admin-color: forbids hex color literals (e.g. '#fff',
 *     '#a1b2c3', '#a1b2c3ff') inside admin source. Admin migrated all 394
 *     hex literals to `--ap-*` CSS variables in PR #139 / #140; this rule
 *     prevents new ones from sneaking back in.
 *
 * Scope is enforced by the consumer (.eslintrc) via an `overrides` block
 * targeting `src/features/admin/**` only — chart palettes and brand colors
 * outside admin are intentionally exempt.
 */
module.exports = {
  rules: {
    'no-hardcoded-admin-color': {
      meta: {
        type: 'problem',
        docs: {
          description:
            'forbid hex literals in admin source; use --ap-* CSS variables',
        },
        schema: [],
        messages: {
          hex: 'use --ap-* CSS variable, not a hex literal ({{value}})',
        },
      },
      create(ctx) {
        const HEX = /#[0-9a-fA-F]{3,8}\b/;
        return {
          Literal(n) {
            if (typeof n.value !== 'string') return;
            const m = n.value.match(HEX);
            if (m) {
              ctx.report({
                node: n,
                messageId: 'hex',
                data: { value: m[0] },
              });
            }
          },
          TemplateElement(n) {
            const raw = n.value && n.value.raw;
            if (typeof raw === 'string' && HEX.test(raw)) {
              ctx.report({
                node: n,
                messageId: 'hex',
                data: { value: raw.match(HEX)[0] },
              });
            }
          },
        };
      },
    },
  },
};
