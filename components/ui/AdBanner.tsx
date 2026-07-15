'use client'

import { useEffect } from 'react'

export default function AdBanner() {
  useEffect(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({})
    } catch {}
  }, [])

  return (
    <ins
      className="adsbygoogle"
      style={{ display: 'block' }}
      data-ad-client="ca-pub-8636084219482805"
      data-ad-slot="6594436306"
      data-ad-format="auto"
      data-full-width-responsive="true"
    />
  )
}
