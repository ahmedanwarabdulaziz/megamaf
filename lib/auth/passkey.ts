import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { createClient } from '@/lib/supabase/server';

const rpName = 'MegaMaf';
const rpID = process.env.NEXT_PUBLIC_RP_ID || 'localhost';
const origin = process.env.NEXT_PUBLIC_ORIGIN || `http://${rpID}:3000`;

export async function getRegistrationOptions(employeeId: string, username: string) {
  const supabase = await createClient();
  const { data: credentials } = await supabase.from('user_credentials').select('credential_id, transports').eq('employee_id', employeeId);
  
  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userID: new Uint8Array(Buffer.from(employeeId)),
    userName: username,
    excludeCredentials: credentials?.map(c => ({
      id: c.credential_id,
      transports: c.transports,
    })) || [],
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'preferred',
    },
  });
  
  return options;
}

export async function verifyRegistration(employeeId: string, response: any, expectedChallenge: string) {
  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (verification.verified && verification.registrationInfo) {
    const { credential, credentialDeviceType } = verification.registrationInfo;
    
    const supabase = await createClient();
    await supabase.from('user_credentials').insert({
      employee_id: employeeId,
      credential_id: credential.id,
      public_key: Buffer.from(credential.publicKey).toString('base64'),
      counter: credential.counter,
      device_label: credentialDeviceType,
      transports: response.response.transports || [],
    });
  }
  
  return verification.verified;
}

export async function getAuthenticationOptions(employeeId?: string) {
  const supabase = await createClient();
  
  let allowCredentials: any[] = [];
  if (employeeId) {
    const { data: credentials } = await supabase.from('user_credentials').select('credential_id, transports').eq('employee_id', employeeId);
    if (credentials) {
      allowCredentials = credentials.map(c => ({
        id: c.credential_id,
        transports: c.transports,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials,
    userVerification: 'preferred',
  });
  
  return options;
}

export async function verifyAuthentication(response: any, expectedChallenge: string, expectedCredentialId: string) {
  const supabase = await createClient();
  const { data: credential } = await supabase.from('user_credentials').select('*').eq('credential_id', expectedCredentialId).single();
  
  if (!credential) return false;

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.credential_id,
      publicKey: new Uint8Array(Buffer.from(credential.public_key, 'base64')),
      counter: Number(credential.counter),
    },
  });

  if (verification.verified && verification.authenticationInfo) {
    const { newCounter } = verification.authenticationInfo;
    await supabase.from('user_credentials').update({ counter: newCounter }).eq('credential_id', expectedCredentialId);
  }
  
  return verification.verified;
}
