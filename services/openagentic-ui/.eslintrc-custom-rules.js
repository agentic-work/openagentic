/**
 * Custom ESLint Rule: No Hardcoded Colors
 *
 * Prevents hardcoded colors in inline styles and ensures all colors use theme variables.
 * This enforces the single source of truth pattern (ThemeContext.jsx).
 */

module.exports = {
  rules: {
    'no-hardcoded-colors': {
      meta: {
        type: 'problem',
        docs: {
          description: 'Disallow hardcoded colors in inline styles - use var(--color-*) instead',
          category: 'Best Practices',
          recommended: true,
        },
        messages: {
          hardcodedHex: 'Hardcoded hex color {{value}} found. Use var(--color-*) from ThemeContext instead.',
          hardcodedRgba: 'Hardcoded rgba/rgb color found. Use var(--color-*) from ThemeContext instead.',
        },
        fixable: null,
        schema: [],
      },
      create(context) {
        return {
          // Check JSXAttribute for style props
          JSXAttribute(node) {
            if (node.name.name !== 'style') return;

            const styleValue = node.value;
            if (!styleValue || styleValue.type !== 'JSXExpressionContainer') return;

            const expression = styleValue.expression;
            if (expression.type !== 'ObjectExpression') return;

            // Check each property in the style object
            expression.properties.forEach((prop) => {
              if (prop.type !== 'Property') return;

              const key = prop.key.name || prop.key.value;
              const value = prop.value;

              // Check if key is a color-related property
              const colorProps = [
                'color',
                'backgroundColor',
                'borderColor',
                'background',
                'fill',
                'stroke',
                'outlineColor',
              ];

              if (!colorProps.includes(key)) return;

              // Check value type
              if (value.type === 'Literal') {
                const strValue = value.value;

                // Check for hex colors
                if (typeof strValue === 'string' && /#[0-9A-Fa-f]{3,8}/.test(strValue)) {
                  context.report({
                    node: value,
                    messageId: 'hardcodedHex',
                    data: { value: strValue },
                  });
                }

                // Check for rgba/rgb
                if (typeof strValue === 'string' && /rgba?\(/.test(strValue)) {
                  context.report({
                    node: value,
                    messageId: 'hardcodedRgba',
                  });
                }
              }

              // Check ternary expressions (theme === 'dark' ? '#XXX' : '#YYY')
              if (value.type === 'ConditionalExpression') {
                [value.consequent, value.alternate].forEach((branch) => {
                  if (branch.type === 'Literal') {
                    const strValue = branch.value;

                    if (typeof strValue === 'string' && /#[0-9A-Fa-f]{3,8}/.test(strValue)) {
                      context.report({
                        node: branch,
                        messageId: 'hardcodedHex',
                        data: { value: strValue },
                      });
                    }

                    if (typeof strValue === 'string' && /rgba?\(/.test(strValue)) {
                      context.report({
                        node: branch,
                        messageId: 'hardcodedRgba',
                      });
                    }
                  }
                });
              }

              // Check template literals
              if (value.type === 'TemplateLiteral') {
                value.quasis.forEach((quasi) => {
                  const strValue = quasi.value.raw;

                  if (/#[0-9A-Fa-f]{3,8}/.test(strValue)) {
                    context.report({
                      node: quasi,
                      messageId: 'hardcodedHex',
                      data: { value: strValue },
                    });
                  }

                  if (/rgba?\(/.test(strValue)) {
                    context.report({
                      node: quasi,
                      messageId: 'hardcodedRgba',
                    });
                  }
                });
              }
            });
          },
        };
      },
    },
  },
};
