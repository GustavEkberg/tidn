/**
 * @fileoverview Disallow Effect.catchAllCause for error wrapping
 *
 * Effect.catchAllCause catches both expected errors AND defects (bugs).
 * Use Effect.catchAll or Effect.mapError instead to only catch expected errors.
 */

/** @type {import('eslint').Rule.RuleModule} */
export const noCatchAllCause = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow Effect.catchAllCause - use catchAll or mapError instead',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noCatchAllCause:
        'Avoid Effect.catchAllCause - it catches defects (bugs) that should crash. Use Effect.catchAll or Effect.mapError to only catch expected errors. See specs/EFFECT_BEST_PRACTICES.md'
    },
    schema: []
  },
  create(context) {
    return {
      // Match Effect.catchAllCause(...)
      CallExpression(node) {
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Effect' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'catchAllCause'
        ) {
          context.report({
            node,
            messageId: 'noCatchAllCause'
          });
        }
      },
      // Match .pipe(Effect.catchAllCause, ...)
      Identifier(node) {
        // Check if this is catchAllCause as a standalone identifier in a pipe
        if (
          node.name === 'catchAllCause' &&
          node.parent &&
          node.parent.type === 'MemberExpression' &&
          node.parent.object.type === 'Identifier' &&
          node.parent.object.name === 'Effect'
        ) {
          // Only report if not already caught by CallExpression
          if (node.parent.parent && node.parent.parent.type !== 'CallExpression') {
            context.report({
              node: node.parent,
              messageId: 'noCatchAllCause'
            });
          }
        }
      }
    };
  }
};
