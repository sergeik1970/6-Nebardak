import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import prettierConfig from "eslint-config-prettier";
import prettierPlugin from "eslint-plugin-prettier";

export default [
    ...nextCoreWebVitals,
    prettierConfig,
    {
        plugins: {
            prettier: prettierPlugin,
        },
        rules: {
            "prettier/prettier": "error",
            "react/display-name": "off",
            // The project does not enable React Compiler. These diagnostics need a
            // dedicated behavioral migration rather than blocking the regular lint gate.
            "react-hooks/preserve-manual-memoization": "off",
            "react-hooks/set-state-in-effect": "off",
        },
    },
];
