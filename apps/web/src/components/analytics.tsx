'use client';

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';
import { GA_ID, analyticsEnabled, pageview } from '@/lib/analytics';

/**
 * Loads Google Analytics (GA4) and reports a page view on every client-side
 * route change. Renders nothing and injects nothing unless NEXT_PUBLIC_GA_ID
 * is configured. We disable GA's automatic page_view (send_page_view:false)
 * and fire our own with the path only, so a reset-token query string never
 * reaches Google.
 */
export function Analytics() {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname) {
      pageview(pathname);
    }
  }, [pathname]);

  if (!analyticsEnabled) {
    return null;
  }

  return (
    <>
      <Script
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        strategy="afterInteractive"
      />
      <Script id="ga-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('config', '${GA_ID}', {
            send_page_view: false,
            anonymize_ip: true
          });
        `}
      </Script>
    </>
  );
}
