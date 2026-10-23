import { createPinia } from 'pinia'
import { createApp } from 'vue'

import './style.css'

import App from './App.vue'
import { installUnauthorizedHandler } from './api/session'
import { i18n } from './i18n'
import router from './router'

const app = createApp(App)

app.use(createPinia())
installUnauthorizedHandler(router)
app.use(router)
app.use(i18n)

app.mount('#app')
