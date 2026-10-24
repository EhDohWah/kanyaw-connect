import { createRouter, createWebHistory, type Router, type RouterHistory } from 'vue-router'

import { useAuthStore } from '@/stores/auth'
import { safeRedirect } from '@/utils/safeRedirect'

declare module 'vue-router' {
  interface RouteMeta {
    /** Needs a signed-in user; others are sent to the login screen. */
    requiresAuth?: boolean
    /** Only for people who are not signed in (login, register). */
    guestOnly?: boolean
    /** Inside a conversation or a call: the bottom bar is hidden. */
    immersive?: boolean
    /** Key in the locale files for the page title. */
    titleKey?: string
  }
}

export function createAppRouter(history: RouterHistory = createWebHistory(import.meta.env.BASE_URL)): Router {
  const router = createRouter({
    history,
    routes: [
      {
        path: '/login',
        name: 'login',
        component: () => import('@/views/LoginView.vue'),
        meta: { guestOnly: true, titleKey: 'auth.signIn' },
      },
      {
        path: '/register',
        name: 'register',
        component: () => import('@/views/RegisterView.vue'),
        meta: { guestOnly: true, titleKey: 'auth.signUp' },
      },
      {
        path: '/',
        component: () => import('@/components/layout/AppShell.vue'),
        meta: { requiresAuth: true },
        children: [
          { path: '', name: 'home', component: () => import('@/views/FeedView.vue'), meta: { titleKey: 'nav.home' } },
          { path: 'chats', name: 'chats', component: () => import('@/views/ChatsView.vue'), meta: { titleKey: 'nav.messages' } },
          {
            path: 'chats/:id',
            name: 'chat',
            component: () => import('@/views/ChatView.vue'),
            meta: { immersive: true, titleKey: 'placeholders.chatTitle' },
          },
          { path: 'rooms', name: 'rooms', component: () => import('@/views/RoomsView.vue'), meta: { titleKey: 'nav.meetings' } },
          {
            path: 'rooms/:id',
            name: 'room',
            component: () => import('@/views/RoomView.vue'),
            meta: { immersive: true, titleKey: 'placeholders.roomTitle' },
          },
          { path: 'profile', name: 'profile', component: () => import('@/views/ProfileView.vue'), meta: { titleKey: 'nav.profile' } },
          { path: 'settings', name: 'settings', component: () => import('@/views/SettingsView.vue'), meta: { titleKey: 'nav.settings' } },
          {
            path: ':pathMatch(.*)*',
            name: 'not-found',
            component: () => import('@/views/NotFoundView.vue'),
            meta: { titleKey: 'notFound.title' },
          },
        ],
      },
    ],
    scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
  })

  router.beforeEach(async (to) => {
    const auth = useAuthStore()

    if (to.meta.guestOnly) {
      // Signed in already (in another tab, say): go where the sign-in page would have gone afterwards.
      return auth.isAuthenticated ? safeRedirect(to.query.redirect) : true
    }

    if (to.meta.requiresAuth) {
      const toLogin = () => ({
        name: 'login',
        query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
      })

      if (!auth.isAuthenticated) return toLogin()

      // Check the saved token with the server once, before the first private page is shown.
      await auth.ensureUser()
      // A refused token clears the session (see the 401 hook), so look again.
      if (!auth.isAuthenticated) return toLogin()
    }

    return true
  })

  return router
}

const router = createAppRouter()

export default router
