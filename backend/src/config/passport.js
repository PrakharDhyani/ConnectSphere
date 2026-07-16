/**
 * Passport — Google OAuth 2.0 Strategy
 *
 * Passport handles the OAuth dance (redirect to Google, code-for-profile
 * exchange); our verify callback below only decides what a Google profile
 * means in OUR user table. We run with session: false everywhere — passport
 * hands us the user for the one callback request, then our own JWTs take
 * over. No server-side session state.
 */

import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";
import { User } from "../models/User.js";
import { logger } from "../utils/logger.js";

export function configurePassport() {
  const clientID = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  // Don't crash local dev just because OAuth creds aren't configured yet —
  // the strategy simply isn't registered, and the /google routes 501.
  if (!clientID || !clientSecret) {
    logger.warn(
      "⚠️  Google OAuth disabled: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET not set"
    );
    return false;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID,
        clientSecret,
        callbackURL: process.env.GOOGLE_CALLBACK_URL,
        scope: ["profile", "email"],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("Google profile did not include an email"));
          }

          // 1. Returning Google user
          let user = await User.findOne({ googleId: profile.id });

          // 2. Existing email/password account with the same email — link it
          //    rather than creating a duplicate. Safe because Google verifies
          //    ownership of the email before ever redirecting back to us.
          if (!user) {
            user = await User.findOne({ email });
            if (user) {
              user.googleId = profile.id;
              user.emailVerified = true;
              if (!user.avatarUrl) user.avatarUrl = profile.photos?.[0]?.value ?? null;
              await user.save();
            }
          }

          // 3. Brand new user
          if (!user) {
            user = await User.create({
              name: profile.displayName,
              email,
              googleId: profile.id,
              avatarUrl: profile.photos?.[0]?.value ?? null,
              emailVerified: true, // Google-verified by definition
            });
          }

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      }
    )
  );

  logger.info("✅ Google OAuth strategy registered");
  return true;
}

export { passport };
