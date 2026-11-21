ALTER TABLE "jwks" ADD COLUMN "alg" TEXT, ADD COLUMN "crv" TEXT;

CREATE TABLE "mcp_oauth_client" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('moc'::text),
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT,
    "clientDiscoveryId" TEXT,
    "disabled" BOOLEAN DEFAULT false,
    "skipConsent" BOOLEAN,
    "enableEndSession" BOOLEAN,
    "subjectType" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "clientCredentialsScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "name" TEXT,
    "uri" TEXT,
    "icon" TEXT,
    "contacts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tos" TEXT,
    "policy" TEXT,
    "softwareId" TEXT,
    "softwareVersion" TEXT,
    "softwareStatement" TEXT,
    "redirectUris" TEXT[],
    "postLogoutRedirectUris" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "backchannelLogoutUri" TEXT,
    "backchannelLogoutSessionRequired" BOOLEAN,
    "tokenEndpointAuthMethod" TEXT,
    "applicationType" TEXT,
    "jwks" TEXT,
    "jwksUri" TEXT,
    "grantTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "responseTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requirePKCE" BOOLEAN,
    "dpopBoundAccessTokens" BOOLEAN DEFAULT false,
    "referenceId" TEXT,
    "metadata" JSONB,
    CONSTRAINT "mcp_oauth_client_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_resource" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mor'::text),
    "identifier" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "accessTokenTtl" INTEGER,
    "refreshTokenTtl" INTEGER,
    "signingAlgorithm" TEXT,
    "signingKeyId" TEXT,
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customClaims" JSONB,
    "dpopBoundAccessTokensRequired" BOOLEAN DEFAULT false,
    "disabled" BOOLEAN DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" INTEGER DEFAULT 1,
    "metadata" JSONB,
    CONSTRAINT "mcp_oauth_resource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_client_resource" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mcr'::text),
    "clientId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "mcp_oauth_client_resource_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_client_assertion" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mca'::text),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_oauth_client_assertion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_refresh_token" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mrt'::text),
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT NOT NULL,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" TIMESTAMP(3),
    "rotatedAt" TIMESTAMP(3),
    "rotationReplayResponse" TEXT,
    "rotationReplayExpiresAt" TIMESTAMP(3),
    "authTime" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],
    CONSTRAINT "mcp_oauth_refresh_token_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_access_token" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mat'::text),
    "token" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "sessionId" TEXT,
    "userId" TEXT,
    "referenceId" TEXT,
    "authorizationCodeId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "refreshId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked" TIMESTAMP(3),
    "confirmation" JSONB,
    "scopes" TEXT[],
    CONSTRAINT "mcp_oauth_access_token_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_oauth_consent" (
    "id" TEXT NOT NULL DEFAULT generate_prefixed_cuid('mcs'::text),
    "clientId" TEXT NOT NULL,
    "userId" TEXT,
    "referenceId" TEXT,
    "resources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requestedUserInfoClaims" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "scopes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "mcp_oauth_consent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mcp_oauth_client_clientId_key" ON "mcp_oauth_client"("clientId");
CREATE INDEX "mcp_oauth_client_userId_idx" ON "mcp_oauth_client"("userId");
CREATE UNIQUE INDEX "mcp_oauth_resource_identifier_key" ON "mcp_oauth_resource"("identifier");
CREATE INDEX "mcp_oauth_client_resource_clientId_idx" ON "mcp_oauth_client_resource"("clientId");
CREATE INDEX "mcp_oauth_client_resource_resourceId_idx" ON "mcp_oauth_client_resource"("resourceId");
CREATE UNIQUE INDEX "mcp_oauth_client_resource_clientId_resourceId_key" ON "mcp_oauth_client_resource"("clientId", "resourceId");
CREATE UNIQUE INDEX "mcp_oauth_refresh_token_token_key" ON "mcp_oauth_refresh_token"("token");
CREATE INDEX "mcp_oauth_refresh_token_clientId_idx" ON "mcp_oauth_refresh_token"("clientId");
CREATE INDEX "mcp_oauth_refresh_token_sessionId_idx" ON "mcp_oauth_refresh_token"("sessionId");
CREATE INDEX "mcp_oauth_refresh_token_userId_idx" ON "mcp_oauth_refresh_token"("userId");
CREATE INDEX "mcp_oauth_refresh_token_authorizationCodeId_idx" ON "mcp_oauth_refresh_token"("authorizationCodeId");
CREATE UNIQUE INDEX "mcp_oauth_access_token_token_key" ON "mcp_oauth_access_token"("token");
CREATE INDEX "mcp_oauth_access_token_clientId_idx" ON "mcp_oauth_access_token"("clientId");
CREATE INDEX "mcp_oauth_access_token_sessionId_idx" ON "mcp_oauth_access_token"("sessionId");
CREATE INDEX "mcp_oauth_access_token_userId_idx" ON "mcp_oauth_access_token"("userId");
CREATE INDEX "mcp_oauth_access_token_authorizationCodeId_idx" ON "mcp_oauth_access_token"("authorizationCodeId");
CREATE INDEX "mcp_oauth_access_token_refreshId_idx" ON "mcp_oauth_access_token"("refreshId");
CREATE INDEX "mcp_oauth_consent_clientId_idx" ON "mcp_oauth_consent"("clientId");
CREATE INDEX "mcp_oauth_consent_userId_idx" ON "mcp_oauth_consent"("userId");

ALTER TABLE "mcp_oauth_client" ADD CONSTRAINT "mcp_oauth_client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_client_resource" ADD CONSTRAINT "mcp_oauth_client_resource_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_client_resource" ADD CONSTRAINT "mcp_oauth_client_resource_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "mcp_oauth_resource"("identifier") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_token" ADD CONSTRAINT "mcp_oauth_refresh_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_token" ADD CONSTRAINT "mcp_oauth_refresh_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_refresh_token" ADD CONSTRAINT "mcp_oauth_refresh_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_token" ADD CONSTRAINT "mcp_oauth_access_token_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_token" ADD CONSTRAINT "mcp_oauth_access_token_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_token" ADD CONSTRAINT "mcp_oauth_access_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_access_token" ADD CONSTRAINT "mcp_oauth_access_token_refreshId_fkey" FOREIGN KEY ("refreshId") REFERENCES "mcp_oauth_refresh_token"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_consent" ADD CONSTRAINT "mcp_oauth_consent_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "mcp_oauth_client"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mcp_oauth_consent" ADD CONSTRAINT "mcp_oauth_consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
