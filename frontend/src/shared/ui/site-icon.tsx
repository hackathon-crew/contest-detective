import { ContestFilterIcon, ProfileIcon } from './context-icons'

const githubPath =
  'M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z'

const solidPaths: Record<string, string> = {
  'arrow-right': 'M13 4.5 11 6.5l4.1 4.1H3v2.8h12.1L11 17.5l2 2 7.5-7.5L13 4.5Z',
  'arrow-up': 'm4.5 11 2 2 4.1-4.1V21h2.8V8.9l4.1 4.1 2-2L12 3.5 4.5 11Z',
  check: 'm9 15.6-4.4-4.4-2.2 2.2L9 20 22 7l-2.2-2.2L9 15.6Z',
  file: 'M5 2h9l6 6v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 2v5h5l-5-5ZM7 12v2h9v-2H7Zm0 5v2h9v-2H7Z',
  copy: 'M8 2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2ZM3 6H1v15a2 2 0 0 0 2 2h15v-2H3V6Z',
  database:
    'M12 2C6.5 2 2 3.8 2 6s4.5 4 10 4 10-1.8 10-4-4.5-4-10-4ZM2 9v4c0 2.2 4.5 4 10 4s10-1.8 10-4V9c-2 2-6 3-10 3S4 11 2 9Zm0 7v2c0 2.2 4.5 4 10 4s10-1.8 10-4v-2c-2 2-6 3-10 3S4 18 2 16Z',
  search:
    'M10 2a8 8 0 1 0 4.9 14.3l5.6 5.6 2.1-2.1-5.9-5.9A8 8 0 0 0 10 2Zm0 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Z',
  link: 'M9 7 6 7a5 5 0 0 0 0 10h3v-3H6a2 2 0 0 1 0-4h3V7Zm6 0v3h3a2 2 0 0 1 0 4h-3v3h3a5 5 0 0 0 0-10h-3ZM7 10.5v3h10v-3H7Z',
  dot: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  minus: 'M4 10.5h16v3H4v-3Z',
  x: 'm5.5 3.5-2 2L10 12l-6.5 6.5 2 2L12 14l6.5 6.5 2-2L14 12l6.5-6.5-2-2L12 10 5.5 3.5Z',
  alert: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm-1.5 4h3v8h-3V6Zm0 10h3v3h-3v-3Z',
  mail: 'M4 3h16a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H4a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3Zm0 3v1.5l8 5 8-5V6l-8 5-8-5Z',
  bell: 'M12 1a2 2 0 0 0-2 2v.4A6 6 0 0 0 6 9v5l-3 4v1h18v-1l-3-4V9a6 6 0 0 0-4-5.6V3a2 2 0 0 0-2-2Zm-3 20a3 3 0 0 0 6 0H9Z',
  refresh:
    'M12 3a9 9 0 0 0-8.6 6.4l2.9.8A6 6 0 0 1 16.2 8H13v3h9V2h-3v4a9 9 0 0 0-7-3Zm-10 10v9h3v-4a9 9 0 0 0 15.6-3.4l-2.9-.8A6 6 0 0 1 7.8 16H11v-3H2Z',
}

export function Icon({ name, large = false }: { name: string; large?: boolean }) {
  const className = large ? 'ic ic-20' : 'ic'
  const solidClassName = `${className} ic-solid`
  if (name === 'github')
    return (
      <svg className={solidClassName} viewBox="0 0 98 96" aria-hidden="true">
        <path d={githubPath} />
      </svg>
    )
  if (name === 'user') return <ProfileIcon className={solidClassName} />
  if (name === 'filter') return <ContestFilterIcon className={solidClassName} />
  if (solidPaths[name])
    return (
      <svg className={solidClassName} viewBox="0 0 24 24" aria-hidden="true">
        <path fillRule="evenodd" clipRule="evenodd" d={solidPaths[name]} />
      </svg>
    )
  return (
    <svg className={className} aria-hidden="true">
      <use href={'#i-' + name} />
    </svg>
  )
}
export function SiteSymbols() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <symbol id="i-search" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </symbol>
      <symbol id="i-arrow-right" viewBox="0 0 24 24">
        <path d="M5 12h14" />
        <path d="m12 5 7 7-7 7" />
      </symbol>
      <symbol id="i-arrow-up" viewBox="0 0 24 24">
        <path d="m5 12 7-7 7 7" />
        <path d="M12 19V5" />
      </symbol>
      <symbol id="i-github" viewBox="0 0 24 24">
        <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
        <path d="M9 18c-4.51 2-5-2-7-2" />
      </symbol>
      <symbol id="i-check" viewBox="0 0 24 24">
        <path d="M20 6 9 17l-5-5" />
      </symbol>
      <symbol id="i-copy" viewBox="0 0 24 24">
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </symbol>
      <symbol id="i-x" viewBox="0 0 24 24">
        <path d="M18 6 6 18" />
        <path d="m6 6 12 12" />
      </symbol>
      <symbol id="i-database" viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M3 5V19A9 3 0 0 0 21 19V5" />
        <path d="M3 12A9 3 0 0 0 21 12" />
      </symbol>
      <symbol id="i-file" viewBox="0 0 24 24">
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </symbol>
      <symbol id="i-globe" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
        <path d="M2 12h20" />
      </symbol>
      <symbol id="i-link" viewBox="0 0 24 24">
        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
      </symbol>
      <symbol id="i-plus" viewBox="0 0 24 24">
        <path d="M5 12h14" />
        <path d="M12 5v14" />
      </symbol>
      <symbol id="i-minus" viewBox="0 0 24 24">
        <path d="M5 12h14" />
      </symbol>
      <symbol id="i-dot" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
      </symbol>
      <symbol id="i-alert" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </symbol>
      <symbol id="i-user" viewBox="0 0 24 24">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </symbol>
      <symbol id="i-filter" viewBox="0 0 24 24">
        <path d="M3 6h18" />
        <path d="M7 12h10" />
        <path d="M10 18h4" />
      </symbol>
    </svg>
  )
}
