import { createPinia } from 'pinia'
import { createApp } from 'vue'

import './style.css'

import App from './App.vue'
import { installSessionSync, installUnauthorizedHandler } from './api/session'
import { i18n } from './i18n'
import { installServiceWorkerMessages } from './push/links'
import router from './router'
import { installPageLoadRecovery } from './router/pageLoad'

const app = createApp(App)

app.use(createPinia())
installUnauthorizedHandler(router)
installSessionSync(router)
installServiceWorkerMessages(router)
installPageLoadRecovery(router)
app.use(router)
app.use(i18n)

app.mount('#app')
