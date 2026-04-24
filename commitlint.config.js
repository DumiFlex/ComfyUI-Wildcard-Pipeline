export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    // Semantic-release generates body lines containing long commit URLs + hashes.
    // Keep subject length enforced; relax body/footer line length so release
    // commits and Co-Authored-By trailers don't fail the hook.
    "body-max-line-length": [0, "always"],
    "footer-max-line-length": [0, "always"],
  },
};
