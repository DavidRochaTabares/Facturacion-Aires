// Must be imported BEFORE the Supabase client: the client consumes and clears the URL fragment (access_token, type=recovery…) while initialising,
// so the original value is captured here to know whether the page was opened from a password-setup link.
export const INITIAL_AUTH_HASH = typeof location === 'undefined' ? '' : location.hash
export const OPENED_FROM_RECOVERY_LINK = /(^|[#&])type=recovery(&|$)/.test(INITIAL_AUTH_HASH)
export const ACTIVATION_TOKEN = (() => {
  const m = /[#&]activar=([A-Za-z0-9%_-]{20,200})/.exec(INITIAL_AUTH_HASH)
  try { return m ? decodeURIComponent(m[1]) : '' } catch { return '' }
})()
export const AUTH_LINK_ERROR = (() => {
  const m = /[#&]error_description=([^&]+)/.exec(INITIAL_AUTH_HASH)
  try { return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '' } catch { return '' }
})()
