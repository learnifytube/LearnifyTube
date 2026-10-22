const tsParser = require("@typescript-eslint/parser");

module.exports = [
  {
    ignores: ["node_modules/**", "android/**", ".expo/**", "dist-apk/**"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      ecmaVersion: "latest",
      sourceType: "module",
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSAnyKeyword'], TSTypeAssertion[typeAnnotation.type='TSAnyKeyword']",
          message:
            "Do not use 'as any'. Prefer proper typing, narrowing, or validation.",
        },
        {
          selector:
            "TSAsExpression[typeAnnotation.type='TSUnknownKeyword'], TSTypeAssertion[typeAnnotation.type='TSUnknownKeyword']",
          message:
            "Do not cast to unknown as a type escape hatch. Prefer runtime validation or a dedicated type guard.",
        },
      ],
    },
  },
  // Components stay under 300 lines of code.
  {
    files: ["**/*.tsx"],
    rules: {
      "max-lines": [
        "error",
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
    },
  },
  // Files that were already over the limit. Shrink this list; never add to it.
  {
    files: [
      "app/(mobile)/(tabs)/discover.tsx",
      "app/(mobile)/(tabs)/index.tsx",
      "app/(mobile)/(tabs)/settings.tsx",
      "app/(mobile)/book-player.tsx",
      "app/(mobile)/connect.tsx",
      "app/(mobile)/player/\\[id\\].tsx",
      "app/(mobile)/share.tsx",
      "app/(tv)/channel/\\[id\\].tsx",
      "app/(tv)/index.tsx",
      "app/(tv)/player/\\[id\\].tsx",
      "app/(tv)/settings.tsx",
      "components/sharing/PeerVideoList.tsx",
    ],
    rules: { "max-lines": "off" },
  },
];
