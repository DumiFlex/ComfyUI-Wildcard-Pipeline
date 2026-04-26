import { createApp } from "vue";
import { createPinia } from "pinia";
import PrimeVue from "primevue/config";
import Aura from "@primevue/themes/aura";
import ToastService from "primevue/toastservice";
import ConfirmationService from "primevue/confirmationservice";
import "primeicons/primeicons.css";
import "./styles/theme.css";
import "./styles/tailwind.css";
import App from "./App.vue";

const app = createApp(App);
app.use(createPinia());
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: ":root",
      cssLayer: { name: "primevue", order: "tailwind-base, primevue, tailwind-utilities" },
    },
  },
});
app.use(ToastService);
app.use(ConfirmationService);
app.mount("#app");
