import { sendError } from '@/errors';
import axios from 'axios';
import { RequestHandler } from 'express';
import { GrantProvider, GrantResponse } from 'grant';
import { NormalisedProfile } from '../utils';

export const OAUTH_ROUTE = '/signin/provider';

const azureBaseUrl = 'https://login.microsoftonline.com';
const workosBaseUrl = 'https://api.workos.com/sso';

export const PROVIDERS_CONFIG: Record<
  string,
  {
    grant: GrantProvider;
    profile: (
      response: GrantResponse
    ) => Promise<NormalisedProfile> | NormalisedProfile;
    middleware?: RequestHandler;
  }
> = {
  azuread: {
    grant: {
      oauth: 2,
      scope_delimiter: ' ',
      client_id: process.env.AUTH_PROVIDER_AZUREAD_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_AZUREAD_CLIENT_SECRET,
      authorize_url: `${azureBaseUrl}/[subdomain]/oauth2/authorize`,
      access_url: `${azureBaseUrl}/[subdomain]/oauth2/token`,
      profile_url: `${azureBaseUrl}/[subdomain]/openid/userinfo`,
      subdomain: process.env.AUTH_PROVIDER_AZUREAD_TENANT || 'common',
    },
    profile: ({ jwt }) => {
      const payload = jwt?.id_token?.payload;
      return {
        id: payload.oid,
        displayName: payload.name,
        email: payload.email,
      };
    },
  },

  bitbucket: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_BITBUCKET_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_BITBUCKET_CLIENT_SECRET,
      scope: ['account'],
    },
    profile: async ({ profile, access_token }) => {
      const {
        data: {
          values: [{ email, is_confirmed }],
        },
      } = await axios.get<{
        values: { email: string; is_confirmed: boolean }[];
      }>(`https://api.bitbucket.org/2.0/user/emails`, {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      return {
        id: profile.uuid,
        displayName: profile.display_name,
        emailVerified: is_confirmed,
        email,
        avatarUrl: profile.links.avatar.href,
      };
    },
  },

  discord: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_DISCORD_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_DISCORD_CLIENT_SECRET,
      scope: ['identify', 'email'],
    },
    profile: ({ profile }) => ({
      id: profile.id,
      displayName: `${profile.username}#${profile.discriminator}`,
      emailVerified: !!profile.verified,
      email: profile.email,
      locale: profile.locale?.slice(0, 2),
      avatarUrl: `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`,
    }),
  },

  facebook: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_FACEBOOK_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_FACEBOOK_CLIENT_SECRET,
      scope: ['email'],
      profile_url: 'https://graph.facebook.com/me?fields=id,name,email,picture',
    },
    profile: ({ profile }) => ({
      id: profile.id,
      displayName: profile.name,
      email: profile.email,
      avatarUrl: profile.picture?.data?.url,
    }),
  },

  github: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_GITHUB_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_GITHUB_CLIENT_SECRET,
      scope: ['user:email'],
    },
    profile: async ({ profile, access_token }) => {
      // * The email is not returned by default, so we need to make a separate request
      const { data: emails } = await axios.get<
        { email: string; primary: boolean; verified: boolean }[]
      >('https://api.github.com/user/emails', {
        headers: { Authorization: `Bearer ${access_token}` },
      });
      const { email, verified } =
        emails.find((email) => email.primary) || emails[0];
      return {
        id: String(profile.id),
        displayName: profile.name,
        avatarUrl: profile.avatar_url,
        email,
        emailVerified: verified,
      };
    },
  },

  gitlab: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_GITLAB_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_GITLAB_CLIENT_SECRET,
      scope: ['read_user'],
    },
    profile: ({ profile }) => ({
      id: String(profile.id),
      displayName: profile.name,
      email: profile.email,
      avatarUrl: profile.avatar_url,
    }),
  },

  google: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_GOOGLE_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_GOOGLE_CLIENT_SECRET,
      scope: ['email', 'profile'],
      custom_params: {
        // * do not re-promt the user for consent
        // prompt: 'consent',
        access_type: 'offline',
      },
    },
    profile: ({
      profile: { sub, name, picture, email, email_verified, locale },
    }) => ({
      id: sub,
      displayName: name,
      avatarUrl: picture,
      email,
      emailVerified: email_verified,
      locale,
    }),
  },

  linkedin: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_LINKEDIN_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_LINKEDIN_CLIENT_SECRET,
      scope: ['r_emailaddress', 'r_liteprofile'],
      profile_url:
        'https://api.linkedin.com/v2/me?projection=(id,localizedFirstName,localizedLastName,profilePicture(displayImage~:playableStreams))',
    },
    profile: async ({ profile, access_token }) => {
      const {
        data: {
          elements: [
            {
              'handle~': { emailAddress: email },
            },
          ],
        },
      } = await axios.get<{
        elements: {
          'handle~': {
            emailAddress: string;
          };
        }[];
      }>(
        'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
        {
          headers: { Authorization: `Bearer ${access_token}` },
        }
      );

      const locale = profile.firstName?.preferredLocale?.language;
      const displayName = `${profile.localizedFirstName} ${profile.localizedLastName}`;

      const avatarUrl = profile.profilePicture?.[
        'displayImage~'
      ]?.elements?.find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => e.authorizationMethod === 'PUBLIC'
      )?.identifiers?.[0]?.identifier;

      return {
        id: profile.id,
        displayName,
        avatarUrl,
        locale,
        email,
      };
    },
  },

  spotify: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_SPOTIFY_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_SPOTIFY_CLIENT_SECRET,
      scope: ['user-read-email', 'user-read-private'],
    },
    profile: ({ profile }) => ({
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      avatarUrl: profile.images?.[0]?.url,
    }),
  },

  strava: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_STRAVA_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_STRAVA_CLIENT_SECRET,
      scope: ['profile:read_all'],
    },
    // ! It is not possible to get the user's email address from Strava
    profile: ({ profile }) => ({
      id: String(profile.id),
      displayName: `${profile.firstname} ${profile.lastname}`,
      avatarUrl: profile.profile,
    }),
  },

  twitch: {
    grant: {
      client_id: process.env.AUTH_PROVIDER_TWITCH_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_TWITCH_CLIENT_SECRET,
      scope: ['user:read:email'],
    },
    profile: ({
      profile: {
        data: [profile],
      },
    }) => ({
      id: profile.id,
      email: profile.email,
      displayName: profile.display_name,
      avatarUrl: profile.profile_image_url,
    }),
  },

  workos: {
    grant: {
      oauth: 2,
      authorize_url: `${workosBaseUrl}/authorize`,
      access_url: `${workosBaseUrl}/token`,
      profile_url: `${workosBaseUrl}/profile`,
      client_id: process.env.AUTH_PROVIDER_WORKOS_CLIENT_ID,
      client_secret: process.env.AUTH_PROVIDER_WORKOS_CLIENT_SECRET,
    },
    profile: ({ profile: { raw_attributes, id, email } }) => ({
      id,
      displayName:
        raw_attributes[
          'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'
        ],
      avatarUrl: raw_attributes['http://schemas.auth0.com/picture'],
      email,
      locale: raw_attributes['http://schemas.auth0.com/locale'],
    }),
    middleware: (
      {
        query: {
          organization = process.env.AUTH_PROVIDER_WORKOS_DEFAULT_ORGANIZATION,
          connection = process.env.AUTH_PROVIDER_WORKOS_DEFAULT_CONNECTION,
          domain = process.env.AUTH_PROVIDER_WORKOKS_DEFAULT_DOMAIN,
        },
      },
      res,
      next
    ) => {
      if (!(organization || connection || domain)) {
        return sendError(res, 'invalid-request', {
          customMessage:
            'You need to give either an organization, a domain or a connection to be able to authenticate with WorkOS',
          redirectTo: res.locals.redirectTo,
        });
      }
      res.locals.grant = {
        dynamic: {
          custom_params: { organization, connection, domain },
        },
      };
      next();
    },
  },
};
