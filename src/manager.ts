import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { router } from './router'
import AppLayout from './components/manager/AppLayout.vue'
import './assets/main.css'

const app = createApp(AppLayout)
app.use(createPinia())
app.use(PrimeVue)
app.use(router)

app.mount('#app')
