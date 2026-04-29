# [1.7.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.6.0...v1.7.0) (2026-04-29)


### Features

* **context:** module picker + lock/internal + card indicators ([#8](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/issues/8)) ([b1fbd13](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/b1fbd13af32415c087288f7f849b8b505f53da1d))

# [1.6.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.5.0...v1.6.0) (2026-04-28)


### Bug Fixes

* **api:** list /modules `total` reflects unpaginated row count ([d536484](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/d53648430d5ad7f5afcdd78e3ad7f3538d06ac3f))
* **spa:** chip pills, derivation $var dropdown, constraint subcat axes ([bab0fe9](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/bab0fe99660f6f0032d3e115ce08e5182cd5b7a3))
* **spa:** pipeline row — drop legacy refselect rules clipping shared select ([3e20ba5](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/3e20ba543c5c828cb9fb4aca544e5595a1ed535b))
* **spa:** rich-text caret + wildcards-list syntax pills ([1298645](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/12986454eb74b947828c6ffc90fa0e09e724698b))
* **spa:** wildcard ref-graph keys by 8-hex UUID, not full slug id ([5f12372](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/5f123722f058ebc44b377f3b735ae5ad289c5f54))
* **ui:** select dropdown — menu scroll works, viewport-aware max-height ([3b9262a](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/3b9262ab2d24e80884b4153ef950555b46b17206))


### Features

* **spa:** uuid pills show var-names everywhere; clickable in test runner ([df046f5](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/df046f57935c42f1dceaa4196b1b99fbf49ac5b3))

# [1.5.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.4.2...v1.5.0) (2026-04-28)


### Bug Fixes

* **api:** flatten embed-bundle response to match other endpoints ([d1d8d02](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/d1d8d025a99e928a7d5af196de4a0c48bc5a5ed2))
* **test-runner:** revert response envelope to flat shape ([1479d57](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/1479d57817b3b4599a263a9edca6517d8a820acb))


### Features

* **api:** add /modules/hashes endpoint for drift detection ([27f3cc9](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/27f3cc989073f8b32535e1e31b714e103e6dca53))
* **api:** add embed-bundle endpoint for lazy walk + transitive deps ([be0b817](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/be0b81768ebdf38a439afdf27d5a344a48190544))
* **db:** add get_by_uuid + get_by_uuids indexed lookups ([a25c700](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/a25c700a9b7e4d6ecb8468d5008010e2d5a52817))
* **db:** add indexed uuid column to modules with backfill ([c2f575d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/c2f575d6f17fa2ed4303fbefb1cea578a65c621e))
* **db:** repository writes uuid + returns payload_hash on every row ([b14b1c2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/b14b1c297c88edf14c3beb4e22e0218a28506633))
* **phase-5.5:** backend bridge — lazy catalog + walker + endpoints ([6ddb0e6](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/6ddb0e68925cc8fcf84edd2d8acd3ac775c52ba5))
* **snapshot:** add canonical SnapshotEntry TypedDict (spec §2.4) ([4d9faa6](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/4d9faa607a70ba77ee91187cf5e0954d840b3ee3))
* **snapshot:** walk_transitive_refs lazy walker (spec §2.10) ([0b43b78](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/0b43b781159bacced67b0c3d6792a7a4907bef6a))
* **spa-types:** add SnapshotEntry + EmbedBundle + embedBundle/hashes client ([bfe98f4](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/bfe98f43b8fd1035edc2f8a297d1db369874349f))
* **test-runner:** lazy catalog — resolve nested @{uuid} refs ([0f6fe72](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/0f6fe721829130bb8bfe12904e06fe510bccfde8))
* **wp-api:** extract_referenced_uuids helper for lazy catalog roots ([339a3f3](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/339a3f38f283f6fddf84db3c25bd223a52cb03e7))
* **wp-nodes:** deserialize_node_input — modules + snapshots + pickOrder ([c319eef](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/c319eef2763fdd793967226eb738256292ef0d18))
* **wp-nodes:** inject __wp_catalog__ from embedded snapshots in WP_Context ([323dd55](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/323dd55e63b3116bb805c3809712dd0b10f09862))


### Performance Improvements

* **test-runner:** hoist catalog walk above per-sample loop ([8817e42](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/8817e423b52f99de669ab5d9a6559fe2c97b97f8))

## [1.4.2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.4.1...v1.4.2) (2026-04-28)


### Bug Fixes

* **spa:** @ autocomplete inserts UUID, editor cross-refs, derivation $ vars ([89c1662](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/89c16624db8c8859a9ba2c683afb5e549b6ecd5b))
* **spa:** @ autocomplete UUIDs, editor cross-refs, derivation $ vars ([0a3e922](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/0a3e92234ff1a4dd24905942ceb407a1b8ee3ec7))
* **spa:** extract 8hex UUID suffix from module DB id for `@{uuid}` refs ([3d18829](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/3d18829e54b52eaac64d7a854aabe40906a39da6))

## [1.4.1](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.4.0...v1.4.1) (2026-04-28)


### Bug Fixes

* **engine:** bump now_iso() to microsecond precision ([fa6c4a1](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/fa6c4a1612ec94d2397a6db92a716d1288c09d89))
* post-merge CI + docs/ ignore ([90f5492](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/90f549259ded6726948738fdea2d4eefdf3c313e))

# [1.4.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.3.0...v1.4.0) (2026-04-28)


### Bug Fixes

* **api:** atomic import + recursion guard + negative pagination + dry now_iso ([82b6c6e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/82b6c6eb37469b1f515639d0883b69f06be8f85b))
* **api:** run migrations on register_routes so production db has tables ([1fc705d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/1fc705d8da7b1ea7a2ae77f3449816bc6d9e4847))
* **api:** use streamresponse return type for spa fallback handlers ([a12ee20](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/a12ee2087c079ac3cab13020abaecd023f107bfd))
* **ci:** python 3.10 datetime compat + rebaseline perf budgets ([eecb38e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/eecb38e85f170b807f109f7149d25eb6d60406e3))
* **db:** drop utcnow + atomic migrations + row factory test ([3810a37](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/3810a373489fbcbaed204017b6ad9626e1706938))
* **db:** id entropy + like escaping + ms timestamps + sentinel typing ([759626b](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/759626b9148345af319e877699e85856e13d084b))
* **db:** unset sentinel for required fields + slug validation + delete consistency ([c4ca447](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/c4ca4472ba44bab4259fd5590f25bd8e5570d91c))
* **engine:** explicit type guard in resolve_module for malformed snapshots ([da0daf4](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/da0daf47e0fc8f781179d6bb35d185ac9f503f29))
* **engine:** isinstance guard avoids dataclass typeguard issue in handlers ([f4bf3d4](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f4bf3d4635a53c57214340a6c00a5a38923f942b))
* **engine:** read module id from raw dict to satisfy union narrowing ([9a98626](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9a98626dd767ae50fc6c6e03ced9a34a68b19f9a))
* **manager:** favorites filter as wp-input box matching prototype ([c246360](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/c246360b97aba838e782e5c4dc19852c7baf7a62))
* **spa:** align theme tokens with extension source of truth ([2917c04](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/2917c04c3897b40d23287ec152883ac77488d84f))
* **spa:** compact buttons + click-to-copy id + logo backdrop + dollar icon + hex color picker ([19727ad](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/19727ade47e057a10cb441342d5b0bab377435cf))
* **spa:** enable primevue dark mode via .wp-dark class on documentelement ([fab8d0d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/fab8d0d20fcd4eb1ca5d6998c984b8ba424e9435))
* **spa:** error handling on store actions + exact-active-class + matchmedia setup ([4cfe1f6](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/4cfe1f6d1487c4bb12b5daa0bbd4b4db57ac6106))
* **spa:** light-mode + dropdown polish for chips, pills, selects ([cd8d23a](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/cd8d23a750cc5a8dd7c8f0aa195f95fe61e14a72)), closes [#a78bfa](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/issues/a78bfa) [#c026d3](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/issues/c026d3)
* **spa:** wrap tailwind in named layers so primevue specificity orders correctly ([f5652f4](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f5652f4286e6b0cbcd6290bf0704f9c335ab8ba2))
* **syntax:** drop vacuous "comment" check in richTokenize.test ([dee9fae](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/dee9fae32808697aeaeb28a52caa24baeaa12801))


### Features

* **api:** /wp/api/modules crud endpoints ([89b7827](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/89b7827534e9814f93cac73d4c4c9261f3b4c9c6))
* **api:** snapshot + match + duplicate + favorite + categories endpoints ([48ee214](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/48ee214f9667eadae372a17b6f25dc58eb8cf42f))
* **api:** spa fallback route + comfyui registration + coverage gates ([51c1756](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/51c17565b8ea28864d076e5829d9689ef4f15967))
* **api:** test runner + library import/export endpoints ([625cab7](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/625cab76820eaa6aa6b31cff91d3284f5a40c5b9))
* **db:** category repository with crud ([746f3ad](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/746f3ad2db6e2e5430c2dde79671bbecbeb0322c))
* **db:** module repository with crud and filtered list ([6c29f73](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/6c29f738c50575329ce240c1cc7cc4c6990370dc))
* **db:** sqlite library foundation + migration runner ([e4aabe6](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/e4aabe6313265a263bca1d3790d43b645f4366c0))
* **engine:** fixedvalueshandler + route legacy dispatch through it ([2eeb900](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/2eeb90052e34952d648e3b8e4456c2b2a0439164))
* **engine:** module dispatcher + modulehandler abc ([f33ac4c](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f33ac4c9803b011f4efb26694f0d674c72970677))
* **engine:** scaffold combine/derivation/constraint/pipeline module types ([a16c532](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/a16c5324e281ffba6a08d3eda46f3deecf2faefa))
* **engine:** snapshot freezing + payload hash + legacy coercion ([9d183d6](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9d183d6779a9a6ce1a9ebbdd558478420883000d))
* **engine:** wildcardhandler with weighted rng and @{ref} resolution ([6626aca](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/6626aca3d7cde2661d6276e867c362e6a9fecb34))
* **manager:** favorites filter as chip toggle box in filter panel ([f51b752](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f51b752fd7a5ad84d3e9e785c4f2c9e98b4b1c84))
* **manager:** surface-conditional @ autocomplete + warning highlights ([7f6f5b7](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/7f6f5b719276019e3409e213cd4e44997977c7a6))
* **manager:** wildcard.max_ref_depth setting (1-32, default 8) ([bc1d21e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/bc1d21e8aa040c6d6bef0c932b16c9b9bfa88663))
* **spa:** add constraints to soon-disabled module types ([9d8a5ab](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9d8a5ab00e565c163c93bba7ce2e5acdce04e96f))
* **spa:** categories color picker (hex + swatch + presets) + sticky-header scroll ([f18be1e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f18be1eaff1cc197ef03251a1a23f4bfdddb2115))
* **spa:** categories manager + import/export + test runner ([a20a7b0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/a20a7b058b64f4b5347de39491e4828c15af0066))
* **spa:** community tab — discover/detail/upload/profile + offline/404 (mock) ([f1add58](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f1add58631286260cde31332e2a1bb40f8a256e7))
* **spa:** dashboard hero + branded categories/import/test pages ([e49df41](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/e49df411d7f56dc89a309f5f5fff057fa32c324a))
* **spa:** datatable expansion + category color chip + tags column ([133c8df](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/133c8df49166fda2f75faba5d79fac44a295781c))
* **spa:** entity list view redesign with active-filter chips + pagination ([370fdd8](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/370fdd838828d96667d48d21c047d128d69325dd))
* **spa:** entitylistview shared list skeleton ([5e8d042](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/5e8d0428d4da0fac6c5dcbe2da6c495ab96a79c7))
* **spa:** fixedvalues.vue per-type list page ([32f0513](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/32f05134202cc035e992f5f4b064971e1a9d318a))
* **spa:** full-page wildcard + fixedvalue forms with sticky footer ([82b568e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/82b568efbb1c75f89980048c5cc09858ea5a42ba))
* **spa:** import/export with per-item selection + conflict resolution ([a5dfe52](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/a5dfe52511e81251d333d6b7cfbfd37e48f8ff00))
* **spa:** kind-aware Test Runner with per-type result panels ([8e28b40](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/8e28b40655930db4f48042f21f7c589149b1440d))
* **spa:** library datatable view with filters + row actions ([af66ca2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/af66ca263e49198fe46efb7e187d6fce2133408a))
* **spa:** per-module version history with last-3 snapshots and restore panel ([678a0eb](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/678a0eb40317cfad442005908378ccb98e6439dc))
* **spa:** per-type routes + drop polymorphic modules.vue ([33542e1](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/33542e123994f462060b341de2c1c25f2a222bb5))
* **spa:** pinia stores for modules + categories + ui ([86c36e0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/86c36e0f52eba4abfb37a4f1621c928ee94e777d))
* **spa:** polish fixed-value form with \$name InputGroup + per-row identifier validation ([928e33c](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/928e33cc5ff445ca11e219fee2fb1a9acadd9a64))
* **spa:** port community sub-screens + drop PrimeVue dependency (Wave 7+8) ([e4ab218](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/e4ab2186e33f04908ff43b0699635bc3f3a982c8))
* **spa:** port prototype dashboard + utilities views (Wave 5) ([1d13048](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/1d1304898267ca0f9521adf16b19712cdef8e1a9))
* **spa:** port prototype editors with EditorFrame scaffold (Wave 4) ([84fc961](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/84fc961fc2f4c31be250ef011e1c6f88430439f4))
* **spa:** port prototype ModuleListView + drop PrimeVue from list screens (Wave 3) ([df5d38d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/df5d38d6250c7856e34b2ac2a7b80ff649da8e0d))
* **spa:** port prototype shell — topbar + sidebar 1:1, drop PrimeVue (Wave 2) ([30fed89](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/30fed89ce3aad313faad8b138eed808766763f56))
* **spa:** port prototype ui primitives + full styles.css (Wave 1) ([03d2b7b](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/03d2b7bde50cd984bf312e73c6f0d200fc731a82))
* **spa:** primevue brand preset derived from --wp-* tokens ([76bcd36](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/76bcd3629d609ce79652109e63025b7027104c6e))
* **spa:** real Combine editor with template + RichTextInput + detected inputs ([d50dd8d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/d50dd8d6015fa01466c34470833ac7ed6b9bf2e8))
* **spa:** real Constraint editor with matrix grid + factor tune popovers ([02a526a](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/02a526a53c7972382ca06742f7d3f8ad73bdfdeb))
* **spa:** real Derivation editor with multi-rule IF/ELIF/ELSE ([4c603a2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/4c603a20db432d9bb4a5c785411af2aa543817ba))
* **spa:** real Pipeline editor with steps stack + module picker modal ([054a777](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/054a777ec1522d07fe017f81bacbfdc302df6100))
* **spa:** redesign Dashboard with brand hero + 6 kind stats + recent/favorites ([0dcb562](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/0dcb562801dd1d0fe395bbe1aedbda037ef87e85))
* **spa:** rich text input + preview with token chips and autocomplete ([6a5bbb4](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/6a5bbb40ef56f66fa1ea1063aa8ddc5f4cedc700))
* **spa:** rich-text input — restore $/@ autocomplete dropdown with keyboard nav ([60f911a](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/60f911a0f8e2e32805e3153b698939e99e90123f))
* **spa:** sakai-style topbar + sidebar layout ([79163fc](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/79163fce79e558c61f201cc44de6ab7405635a0b))
* **spa:** scaffold combine/derivation/constraint/pipeline list + edit views ([8c03e72](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/8c03e72d69785a7ae2b7101250cd35987e307231))
* **spa:** shared typepill + relativedate components ([f3a1066](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/f3a10664ab64bc1da83914629dbfe07d1adcda71))
* **spa:** tags editor on forms + sort dropdown + category/tags filters ([0722da2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/0722da2a98ae4f544a94df241faf17dad40ac0d2))
* **spa:** theme toggle (dark/light/auto) with flash-suppression ([1b7576a](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/1b7576a55fb33af05b2f4ca6355354d1a032ab2e))
* **spa:** topbar logo + 4-section sakai sidebar with primeicons ([42f30ef](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/42f30efbe7c699d9f7ab2565cee37ce48ec123a2))
* **spa:** tweaks panel — accent palette + density + sidebar runtime switcher (Wave 6) ([975581e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/975581e111f1acfb13ec421a925af68a6fda8592))
* **spa:** typed api client wrapping /wp/api/* ([7a7b632](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/7a7b632f0693976b20b16ed5ef4c2aacb8dd7890))
* **spa:** vite + tailwind + primevue scaffold ([7a47035](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/7a4703546edc2467a75b4c132915bdf666e4dd70))
* **spa:** vue router + 7 stub views ([d80fd24](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/d80fd242545ef794aa0b013f1ff1178f65242919))
* **spa:** wildcard + fixed-values editors ([8abab1e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/8abab1ee3d0e83604030c2e97e777e23275dc86a))
* **spa:** wildcard form gains varBinding field + RichTextInput on option values ([d84bd2d](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/d84bd2d60b048fe6790d629d3b46067304050e8c))
* **spa:** wildcard sub-categories define + assign per option ([8a1b820](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/8a1b820ab3f3998d1abcb7160d19c549daa74c52))
* **spa:** wildcards list — syntax indicator column + nested-ref filters ([80cc323](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/80cc323f31b394c95a4de6f9e429bbf6fd6cd1db))
* **spa:** wildcards.vue with full datatable + filter + bulk select ([22c29aa](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/22c29aa090511b352c80035c60702435f0da431a))
* **syntax:** _resolve_inline_pick — uniform random branch + recurse ([2f48900](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/2f489002e17de9ea092a05dde1b069f3edf0fbdc))
* **syntax:** _resolve_multi_pick — weighted without-replacement + sep join ([966ab4b](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/966ab4b1aac965f7b8601517a8ddfeb534aeb7a5))
* **syntax:** _resolve_ref with surface/depth/cycle checks + weighted pick ([51a859b](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/51a859b0956091fee9e296097b9b6779dd99b52d))
* **syntax:** foundation types, error classes, ResolveContext Protocol ([45c2fa9](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/45c2fa9bc48cecb25410aa04fd3ee993b442afb8))
* **syntax:** resolve_text dispatch loop with text/escape/var resolution ([9e05e1f](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9e05e1fb668edc9bcabbcfeda154e90c1682e4ea))
* **syntax:** resolveTokens TS twin of Python resolve_text ([9d3c6a9](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9d3c6a9851be55d60ea24df8abc9953f662eda38))
* **syntax:** tokenize $var and @{uuid} kinds + corpus cases ([4fb2c99](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/4fb2c997714d9bfc51f806b65a02b3bba8c0f4be))
* **syntax:** tokenize dp_brace + dp_multi with nesting support ([9364eb8](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9364eb84f5899ab7d2e2dc2111f4c769d3c2c384))
* **syntax:** tokenize_text — text + escape kinds with lossless invariant ([11ac437](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/11ac437fa391edcacdf210b8cb3e9d73e7c48cf7))

# [1.3.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.2.0...v1.3.0) (2026-04-26)


### Features

* i18n locales (en) + per-node help pages ([#2](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/issues/2)) ([5216547](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/52165471c0da315db59d2b2fb72537d7b06d62ef))

# [1.2.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.1.0...v1.2.0) (2026-04-26)


### Features

* polish suite — MVP frontend + subgraph support + DX + a11y ([79bdb45](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/79bdb457cbc98e191766e3fa7c84df2e1106ecc2))

# [1.1.0](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/compare/v1.0.0...v1.1.0) (2026-04-24)


### Bug Fixes

* **engine:** annotate Module as TypeAlias so Pyright treats it as a type ([e1ab2f1](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/e1ab2f1f18f99c2e9971baeaeed9f769070b4099))


### Features

* **engine:** add Context type and strip_internals helper ([61a2e0e](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/61a2e0e9acb44a04a0f0d07d7656811160d03ee6))
* **engine:** add handle_fixed_values handler ([95ef0f9](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/95ef0f95d2f6aadee80343e3487a7abeeda71f12))
* **engine:** add module dataclasses and JSON round-trip helpers ([9f8fbf1](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/9f8fbf13e4db8c4b155e997420fdd58d4988cf97))
* **engine:** add PipelineEngine with dispatcher and per-module tracing ([3f7236f](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/3f7236f61b36519a2ab7f265ff5c66985b8225b5))
* **engine:** add template.resolve_variables with $var and $$ escape ([3399184](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/339918464e4a9500fc5bf574a0b499d5fc4e70b8))

# 1.0.0 (2026-04-24)


### Bug Fixes

* add __init__.py stub for ComfyUI loader; drop deprecated tsconfig baseUrl ([426f417](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/426f4175d69d773e4e72a1ec97da8239c5b6e560))
* **commitlint:** disable body/footer max-line-length for release commits ([20f0779](https://github.com/DumiFlex/ComfyUI-WildcardPipeline/commit/20f077981e2986799f61583bb9841f61258aba73))
