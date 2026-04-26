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

const app = createApp(App);
app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: WildcardPreset,
    options: {
      darkModeSelector: ":root",
      cssLayer: { name: "primevue", order: "tailwind-base, primevue, tailwind-utilities" },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.mount("#app");
