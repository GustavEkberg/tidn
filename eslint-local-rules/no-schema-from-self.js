/**
 * @fileoverview Disallow *FromSelf schema variants
 *
 * Schema variants like OptionFromSelf, EitherFromSelf, ChunkFromSelf expect
 * runtime representations and don't serialize to JSON properly.
 * Use the standard variants (Option, Either, Chunk) instead.
 */

const FROM_SELF_SCHEMAS = [
  'OptionFromSelf',
  'EitherFromSelf',
  'ChunkFromSelf',
  'ListFromSelf',
  'HashMapFromSelf',
  'HashSetFromSelf',
  'SortedSetFromSelf',
  'CauseFromSelf',
  'ExitFromSelf',
  'FiberIdFromSelf',
  'DurationFromSelf'
];

/** @type {import('eslint').Rule.RuleModule} */
export const noSchemaFromSelf = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow *FromSelf schema variants - use standard variants instead',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noFromSelf:
        'Avoid Schema.{{name}} - use Schema.{{alternative}} instead for JSON serialization. See specs/EFFECT_BEST_PRACTICES.md'
    },
    schema: []
  },
  create(context) {
    return {
      MemberExpression(node) {
        if (
          node.object.type === 'Identifier' &&
          node.object.name === 'Schema' &&
          node.property.type === 'Identifier' &&
          FROM_SELF_SCHEMAS.includes(node.property.name)
        ) {
          const name = node.property.name;
          const alternative = name.replace('FromSelf', '');

          context.report({
            node,
            messageId: 'noFromSelf',
            data: { name, alternative }
          });
        }
      }
    };
  }
};
