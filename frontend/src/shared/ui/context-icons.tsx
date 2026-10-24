import type { SVGProps } from 'react'

export function ProfileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path
        fillRule="evenodd"
        d="M5 4a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H5Zm3 3a2.25 2.25 0 1 0 0 4.5A2.25 2.25 0 0 0 8 7Zm-3.5 9a3.5 3.5 0 0 1 7 0v1h-7v-1ZM14 8h5v2h-5V8Zm0 5h5v2h-5v-2Z"
        clipRule="evenodd"
      />
    </svg>
  )
}

export function ContestFilterIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M4.5 3A1.5 1.5 0 0 0 3 4.5v1.4c0 .4.16.78.44 1.06L10 13.5v6a1 1 0 0 0 1.45.9l3-1.5a1 1 0 0 0 .55-.9v-4.5l5.56-6.54c.28-.28.44-.66.44-1.06V4.5A1.5 1.5 0 0 0 19.5 3h-15Z" />
    </svg>
  )
}
