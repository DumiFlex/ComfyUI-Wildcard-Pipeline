## [0.1.2](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/compare/v0.1.1...v0.1.2) (2026-04-03)


### Bug Fixes

* **ci:** use publish-node-action@main to support skip_checkout ([a61a9b1](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/a61a9b111934a15df1e4a4d35cd9b5d416d0c51c))

## [0.1.1](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/compare/v0.1.0...v0.1.1) (2026-04-03)


### Bug Fixes

* **ci:** use skip_checkout in publish workflow so built js/ is included ([52142fb](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/52142fbeb57730a4367f15c51814386b54fa5569))

# [0.1.0](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/compare/v0.0.0...v0.1.0) (2026-04-03)


### Bug Fixes

* **api:** use random.Random instance in preview handler for engine rng compat ([538449a](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/538449a80e25f93ca673c6587aaf6a00e0286559))
* **api:** wire preview seed into wildcard selection via __wp_node_seed__ ([93c3099](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/93c3099089f0d137cacdf5247f71613ac0bc6080))
* capture actual seed for linked inputs via executed event and Python ui output ([56114c7](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/56114c7c7e6431c8fae6a0ab06929b9221144a65))
* **frontend:** capture seed before control_after_generate randomizes it ([153e32e](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/153e32e89e4b943190a0499ead6da7db1687fd2d))
* propagate conflict refresh to downstream pipeline nodes on connection change ([846d2fb](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/846d2fb451cf811692d4868e1cc1d236c4067c47))
* remove export module, add bidirectional conflict reactivity and ordering validation ([5e5df42](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/5e5df42e1cac15e48745e1d5d1913966f8f64e3d))
* **style:** remove transitions from lock and internal buttons ([eed769b](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/eed769b51c630d545f2c4c07c9f1f551bd355fe2))


### Features

* add constrain, condition, and export modules with Vue components ([7a89740](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/7a897401a86a7e72248877bdf566ed81a84e0244))
* add per-slot enable/disable and internal toggle to ContextInject widget ([5310b10](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/5310b10c711ba063a14685619e751e20be0b102a))
* add visual conflict highlighting to pipeline and inject widgets ([dab06e2](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/dab06e2b91559c303ddb0ca4bc306689546b3212))
* **api:** add preview endpoint for pipeline dry-run ([9ff19e1](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/9ff19e187da21fbd602d2512d98f271b8c4a3e0c))
* **api:** implement CRUD endpoints, FileStore service, and SPA serving ([c59f3dc](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/c59f3dc540cdc23a7a70e12abdfb9d25820eb638))
* **api:** return module_seeds and filter internal vars in preview ([30d95b3](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/30d95b3ed14493c4f2fc5a72c7e78971419c20ee))
* **engine:** add module enable/disable toggle and condition modal redesign ([36acb65](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/36acb650ba1acaa15349474037f675ff698c4c25))
* **engine:** implement weighted sampling, variable resolution, and schema validation ([0a059b8](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/0a059b89e29602ccfc011c9318ef4da93c335217))
* **engine:** inject RNG instance and track per-module seeds ([9afe5ce](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/9afe5cebe679be748a5f1a32d0665908a3ed7197))
* **engine:** record internal variable metadata in context ([697da05](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/697da05dd44f78128ed7b441080e49e4287915f8))
* **engine:** support locked_seed on wildcard modules ([f607db8](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/f607db832da5bb3ca1f4e2c889cdeea5976444f9))
* **frontend:** add lock and internal types, graph filtering, UI buttons ([4b1e48c](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/4b1e48cb1d53013073dde09e23d335e551c369a9))
* **frontend:** add Vue DOM widgets for pipeline and assembler nodes ([c213488](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/c213488eddd59c36da78de193e1253a75949295e))
* **frontend:** install primeicons and migrate widget icons from unicode to pi classes ([828eebf](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/828eebf963ad3c775f4e5383af6d3fe1bd9111c5))
* **frontend:** integrate preview API with assembler widget and enable/disable toggle ([497df07](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/497df07b4425ae5d072433ce1fd42f2f0ed9657d))
* **manager:** add Manager SPA with Vue Router, Pinia stores, and PrimeVue CRUD views ([4b0ab92](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/4b0ab9219684e8f219d35cab76f0482b8f4f7965))
* **node:** filter internal vars in PromptAssembler ([c63ab3d](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/c63ab3df73b6025c85953000822008a98c993068))
* **node:** pass Random instance from pipeline node to engine ([01d6664](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/01d66641dd058bdbebfed6ec17e4f84105c7f34b))
* **nodes:** resolve wildcard sources and wire engine into nodes ([40a581c](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/40a581c2d92798bfc783c131b61a84a570096562))
* **pipeline:** add right-click context menu with move, duplicate, delete, and conflict dismissal actions ([e24bafa](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/e24bafaad841fdc9c0112e5d8b7713d9d3845f9e))
* redesign Manager SPA, Vue DOM widgets, and fix runtime bugs ([e1a5c81](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/commit/e1a5c81ecbce2c891f14d6f31dd34b1322231ac4))
