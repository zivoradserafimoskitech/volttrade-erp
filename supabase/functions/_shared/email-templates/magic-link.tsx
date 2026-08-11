/// <reference types="npm:@types/react@18.3.1" />

import * as React from 'npm:react@18.3.1'
import { Body, Button, Head, Heading, Html, Preview, Text } from 'npm:@react-email/components@0.0.22'
import { Shell, Signature, button, footer, h1, main, text } from './brand.tsx'

interface MagicLinkEmailProps {
  siteName: string
  confirmationUrl: string
}

export const MagicLinkEmail = ({ siteName, confirmationUrl }: MagicLinkEmailProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your login link for {siteName}</Preview>
    <Body style={main}>
      <Shell>
        <Heading style={h1}>Your login link</Heading>
        <Text style={text}>
          Use the button below to sign in to {siteName}. This link expires shortly.
        </Text>
        <Button style={button} href={confirmationUrl}>
          Log in
        </Button>
        <Text style={footer}>If you didn't request this link, you can safely ignore this email.</Text>
        <Signature siteName={siteName} />
      </Shell>
    </Body>
  </Html>
)

export default MagicLinkEmail
