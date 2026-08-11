/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Container, Img, Section, Text } from 'npm:@react-email/components@0.0.22'

export const BANNER_URL = 'https://volttrade-erp.lovable.app/email-banner.png'
export const LOGO_URL = 'https://volttrade-erp.lovable.app/email-logo.png'

export const main = {
  backgroundColor: '#0b1018',
  fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  margin: '0',
  padding: '24px 0',
}

export const card = {
  width: '100%',
  maxWidth: '560px',
  margin: '0 auto',
  backgroundColor: '#111827',
  borderRadius: '14px',
  overflow: 'hidden' as const,
  border: '1px solid #1f2a3a',
}

export const banner = {
  display: 'block' as const,
  width: '100%',
  maxWidth: '560px',
  height: 'auto',
  objectFit: 'cover' as const,
}

export const bannerWrap = { backgroundColor: '#0d1220', lineHeight: '0' }

export const inner = { padding: '28px 32px 32px' }

export const h1 = {
  fontSize: '22px',
  fontWeight: 'bold' as const,
  color: '#f1f5f9',
  margin: '0 0 16px',
}

export const text = {
  fontSize: '14px',
  color: '#a5b0c0',
  lineHeight: '1.6',
  margin: '0 0 22px',
}

export const link = { color: '#22d39a', textDecoration: 'underline' }

export const button = {
  backgroundColor: '#1dc98a',
  color: '#08130f',
  fontSize: '14px',
  fontWeight: 'bold' as const,
  borderRadius: '10px',
  padding: '13px 24px',
  textDecoration: 'none',
  display: 'inline-block' as const,
}

export const codeStyle = {
  fontFamily: 'Courier, monospace',
  fontSize: '24px',
  letterSpacing: '4px',
  fontWeight: 'bold' as const,
  color: '#f1f5f9',
  backgroundColor: '#0d1220',
  border: '1px solid #1f2a3a',
  borderRadius: '10px',
  padding: '14px 18px',
  margin: '0 0 28px',
}

export const footer = {
  fontSize: '12px',
  color: '#66748a',
  margin: '28px 0 0',
  lineHeight: '1.6',
}

export const logoBar = {
  backgroundColor: '#0d1220',
  padding: '22px 32px 14px',
  borderBottom: '1px solid #16203150',
}

export const logo = { display: 'block' as const, height: '26px', width: 'auto' }

export const Banner = () => (
  <>
    <Section style={logoBar}>
      <Img src={LOGO_URL} alt="VoltTrade" height="26" style={logo} />
    </Section>
    <Section style={bannerWrap}>
      <Img src={BANNER_URL} alt="" width="560" style={banner} />
    </Section>
  </>
)

export const Shell = ({ children }: { children: React.ReactNode }) => (
  <Container style={card}>
    <Banner />
    <Section style={inner}>{children}</Section>
  </Container>
)

export const Signature = ({ siteName }: { siteName: string }) => (
  <Text style={footer}>— The {siteName} team</Text>
)
