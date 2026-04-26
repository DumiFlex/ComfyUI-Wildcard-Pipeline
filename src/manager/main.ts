import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import { WildcardPreset } from "./styles/preset";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import "primeicons/primeicons.css";
import "./styles/theme.css";
import "./styles/tailwind.css";
import App from "./App.vue";
import router from "./router";

// Force PrimeVue dark mode by adding the matching class on the html root.
// PrimeVue 4 treats `darkModeSelector` as a CSS selector that toggles dark
// scope tokens; `":root"` is not a recognized variant, so we use a class
// and apply it eagerly. Light mode is not supported in v1.
document.documentElement.classList.add("wp-dark");

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: WildcardPreset,
    options: {
      darkModeSelector: ".wp-dark",
      cssLayer: { name: "primevue", order: "tailwind-base, primevue, tailwind-utilities" },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.mount("#app");
