import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ToastService from 'primevue/toastservice'
import { router } from './router'
import AppLayout from './components/manager/AppLayout.vue'
import { WildcardPipelinePreset } from './theme/preset'
import './assets/main.css'

const app = createApp(AppLayout)
app.use(createPinia())
app.use(PrimeVue, {
  theme: {
    preset: WildcardPipelinePreset,
    options: {
      darkModeSelector: '.app-dark',
      prefix: 'p'
    }
  }
})
app.use(ToastService)
app.use(router)

app.mount('#app')
