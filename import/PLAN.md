# FMBot JavaScript Rewrite Plan

## Executive Summary

FMBot is a production-grade Last.fm Discord bot currently built with C# (.NET 10.0). This document outlines the comprehensive plan to rewrite the entire application in JavaScript (Node.js). The bot serves 640+ Discord shards across 12 instances, providing music statistics, "WhoKnows" commands, music bot scrobbling, image generation, and extensive integrations with Last.fm, Spotify, Apple Music, YouTube, Discogs, and AI services.

---

## Current Architecture Overview

### Technology Stack (Current)
- **Language:** C# (.NET 10.0)
- **Discord Library:** NetCord (gateway client)
- **Database:** PostgreSQL with EF Core + Dapper
- **Background Jobs:** Hangfire
- **Image Generation:** PuppeteerSharp + SkiaSharp
- **Logging:** Serilog
- **Metrics:** prometheus-net
- **API Communication:** gRPC, REST, GraphQL
- **Testing:** NUnit + Moq
- **Deployment:** Docker (multi-stage), 12 instances, 640 shards

### Key Features
1. **Music Statistics:** User/server-wide top artists, albums, tracks
2. **WhoKnows System:** Find who listens to your favorites in a server
3. **Music Bot Scrobbling:** Auto-detect songs from music bots in voice channels
4. **Crown System:** Award crowns to top listeners
5. **Import:** Spotify/Apple Music full history import
6. **Discogs Integration:** Record collection management
7. **Image Generation:** Charts, statistics, world maps
8. **AI Features:** OpenAI integration
9. **Games:** Jumble word game
10. **Supporter System:** Premium subscriptions via OpenCollective/Stripe
11. **Featured User:** Rotating bot profile picture
12. **Server Indexing:** Cache server member data
13. **Friends System:** Compare stats with friends
14. **Shortcuts:** Custom command aliases

---

## Target Technology Stack

| Component | Current (.NET) | Target (JavaScript) | Rationale |
|-----------|----------------|---------------------|-----------|
| **Runtime** | .NET 10.0 | Node.js 22+ LTS | Modern async/await, ecosystem |
| **Language** | C# 13 | JavaScript (ES2024) / TypeScript 5.5+ | Consider TypeScript for type safety |
| **Discord Library** | NetCord | discord.js v14 | Most mature, well-documented |
| **Database ORM** | EF Core + Dapper | Prisma ORM + raw pg | Type-safe, PostgreSQL support |
| **Background Jobs** | Hangfire | BullMQ + Redis | Industry standard, Redis-based |
| **Logging** | Serilog | Pino | High-performance JSON logging |
| **Metrics** | prometheus-net | prom-client | Official Prometheus client |
| **Config** | IOptions + JSON | dotenv + zod validation | Simple, validated config |
| **Image Generation** | PuppeteerSharp + SkiaSharp | Puppeteer + sharp | Direct equivalents |
| **gRPC Client** | Grpc.Net.Client | @grpc/grpc-js | Official gRPC library |
| **HTTP Client** | RestSharp / HttpClient | axios | Promise-based, interceptors |
| **GraphQL** | GraphQL.Client | graphql-request | Lightweight, simple |
| **Testing** | NUnit + Moq | Vitest + ts-mockito or Jest | Fast, modern testing |
| **Build** | dotnet build | No build (JS) / tsc (if TS) | Simpler deployment |
| **Package Manager** | NuGet | pnpm | Fast, disk-efficient |

---

## Project Structure

```
fmbot/
├── src/
│   ├── bot/                      # Main Discord bot
│   │   ├── commands/
│   │   │   ├── text/             # Text commands (.fm, .whoknows)
│   │   │   │   ├── FmCommand.js
│   │   │   │   ├── WhoknowsCommand.js
│   │   │   │   ├── TopCommand.js
│   │   │   │   ├── CrownCommand.js
│   │   │   │   ├── FriendsCommand.js
│   │   │   │   └── ... (16 commands)
│   │   │   └── slash/            # Slash commands (/fm, /whoknows)
│   │   │   ├── AlbumCommands.js
│   │   │   ├── ArtistCommands.js
│   │   │   ├── ChartCommands.js
│   │   │   ├── CountryCommands.js
│   │   │   ├── CrownCommands.js
│   │   │   ├── DiscogsCommands.js
│   │   │   ├── FriendCommands.js
│   │   │   ├── GenreCommands.js
│   │   │   ├── ImportCommands.js
│   │   │   ├── IndexCommands.js
│   │   │   ├── PlayCommands.js
│   │   │   ├── ServerCommands.js
│   │   │   ├── SpotifyCommands.js
│   │   │   ├── StaticCommands.js
│   │   │   ├── TemplateCommands.js
│   │   │   ├── TopCommands.js
│   │   │   ├── TrackCommands.js
│   │   │   ├── UserCommands.js
│   │   │   ├── YoutubeCommands.js
│   │   │   └── AppleMusicCommands.js
│   │   ├── handlers/
│   │   │   ├── CommandHandler.js     # Text command routing
│   │   │   ├── InteractionHandler.js # Slash/button/modal handling
│   │   │   ├── ClientLogHandler.js   # Discord client events
│   │   │   ├── UpdateQueueHandler.js # User update queue
│   │   │   └── UserEventHandler.js   # User join/leave events
│   │   ├── services/             # Business logic
│   │   │   ├── AdminService.js
│   │   │   ├── AlbumService.js
│   │   │   ├── AliasService.js
│   │   │   ├── ArtistsService.js
│   │   │   ├── CensorService.js
│   │   │   ├── ChartService.js
│   │   │   ├── CountryService.js
│   │   │   ├── CrownService.js
│   │   │   ├── DiscogsService.js
│   │   │   ├── EurovisionService.js
│   │   │   ├── FeaturedService.js
│   │   │   ├── FriendsService.js
│   │   │   ├── GameService.js
│   │   │   ├── GenreService.js
│   │   │   ├── ImportService.js
│   │   │   ├── IndexService.js
│   │   │   ├── MusicBotService.js    # Music bot scrobbling
│   │   │   ├── PlayService.js
│   │   │   ├── SettingService.js
│   │   │   ├── ShortcutService.js
│   │   │   ├── SupporterService.js
│   │   │   ├── TemplateService.js
│   │   │   ├── TimeService.js
│   │   │   ├── TimerService.js
│   │   │   ├── TrackService.js
│   │   │   ├── UpdateService.js
│   │   │   ├── UserService.js
│   │   │   ├── FmSettingService.js
│   │   │   ├── YoutubeService.js
│   │   │   ├── IdResolutionService.js
│   │   │   ├── OpenAiService.js
│   │   │   ├── MusicBrainzService.js
│   │   │   ├── guild/
│   │   │   │   ├── GuildIndexService.js
│   │   │   │   └── GuildSettingService.js
│   │   │   └── whoknows/
│   │   │       ├── WhoKnowsService.js
│   │   │       ├── WhoKnowsArtistService.js
│   │   │       ├── WhoKnowsAlbumService.js
│   │   │       ├── WhoKnowsTrackService.js
│   │   │       ├── WhoKnowsPlayService.js
│   │   │       └── WhoKnowsFilterService.js
│   │   ├── builders/             # Response builders (Discord embeds)
│   │   │   ├── AlbumBuilder.js
│   │   │   ├── ArtistBuilder.js
│   │   │   ├── ChartBuilder.js
│   │   │   ├── CountryBuilder.js
│   │   │   ├── CrownBuilder.js
│   │   │   ├── DiscogsBuilder.js
│   │   │   ├── EurovisionBuilder.js
│   │   │   ├── FriendBuilder.js
│   │   │   ├── GameBuilder.js
│   │   │   ├── GenreBuilder.js
│   │   │   ├── GuildBuilder.js
│   │   │   ├── GuildSettingBuilder.js
│   │   │   ├── ImportBuilder.js
│   │   │   ├── PlayBuilder.js
│   │   │   ├── PremiumSettingBuilder.js
│   │   │   ├── RecapBuilder.js
│   │   │   ├── StaticBuilder.js
│   │   │   ├── TemplateBuilder.js
│   │   │   ├── TrackBuilder.js
│   │   │   ├── UserBuilder.js
│   │   │   └── YoutubeBuilder.js
│   │   ├── interactions/         # Component interactions
│   │   │   ├── AlbumInteractions.js
│   │   │   ├── ArtistInteractions.js
│   │   │   ├── ChartInteractions.js
│   │   │   ├── CrownInteractions.js
│   │   │   ├── DiscogsInteractions.js
│   │   │   ├── FriendInteractions.js
│   │   │   ├── GameInteractions.js
│   │   │   ├── ImportInteractions.js
│   │   │   ├── PlayInteractions.js
│   │   │   ├── RecapInteractions.js
│   │   │   ├── TemplateInteractions.js
│   │   │   ├── TopInteractions.js
│   │   │   ├── UserInteractions.js
│   │   │   ├── WhoKnowsInteractions.js
│   │   │   ├── YoutubeInteractions.js
│   │   │   └── AppleMusicInteractions.js
│   │   ├── models/               # Data models/DTOs
│   │   │   ├── ContextModel.js
│   │   │   ├── ResponseModel.js
│   │   │   ├── AlbumModels.js
│   │   │   ├── ArtistModels.js
│   │   │   ├── ChartModels.js
│   │   │   ├── CountryModels.js
│   │   │   ├── CrownModels.js
│   │   │   ├── DiscogsModels.js
│   │   │   ├── GameModels.js
│   │   │   ├── GenreModels.js
│   │   │   ├── GuildModels.js
│   │   │   ├── ImportModels.js
│   │   │   ├── IndexModels.js
│   │   │   ├── TrackModels.js
│   │   │   ├── UserModels.js
│   │   │   ├── WhoKnowsModels.js
│   │   │   └── TimePeriod.js
│   │   ├── attributes/           # Command decorators/validators
│   │   │   ├── GuildOnly.js
│   │   │   ├── RequiresIndex.js
│   │   │   ├── ServerStaffOnly.js
│   │   │   ├── SupporterEnhanced.js
│   │   │   ├── SupporterExclusive.js
│   │   │   ├── UsernameSetRequired.js
│   │   │   ├── UserSessionRequired.js
│   │   │   └── ... (8 more)
│   │   ├── utils/                # Utility functions
│   │   ├── extensions/           # Helper extensions
│   │   ├── factories/            # Factory classes
│   │   ├── interfaces/           # Interface definitions (JSDoc)
│   │   ├── resources/            # Static resources
│   │   └── index.js              # Main entry point
│   │
│   ├── persistence/              # Database layer
│   │   ├── prisma/
│   │   │   ├── schema.prisma     # Full database schema
│   │   │   └── migrations/       # Database migrations
│   │   ├── repositories/
│   │   │   ├── AlbumRepository.js
│   │   │   ├── ArtistRepository.js
│   │   │   ├── PlayRepository.js
│   │   │   ├── PlayDataSourceRepository.js
│   │   │   ├── TrackRepository.js
│   │   │   └── UserRepository.js
│   │   └── index.js
│   │
│   ├── lastfm/                   # Last.fm API integration
│   │   ├── api/
│   │   │   ├── LastfmApi.js      # Main Last.fm API client
│   │   │   └── methods/          # API method implementations
│   │   │       ├── UserMethods.js
│   │   │       ├── ArtistMethods.js
│   │   │       ├── AlbumMethods.js
│   │   │       ├── TrackMethods.js
│   │   │       ├── ChartMethods.js
│   │   │       └── LibraryMethods.js
│   │   ├── models/               # Last.fm response models
│   │   ├── repositories/
│   │   │   ├── LastFmRepository.js
│   │   │   └── SmallIndexRepository.js
│   │   └── index.js
│   │
│   ├── images/                   # Image generation
│   │   ├── generators/
│   │   │   ├── PuppeteerService.js   # Headless Chrome rendering
│   │   │   └── ImageProcessor.js     # sharp-based processing
│   │   ├── templates/            # HTML templates
│   │   │   ├── receipt.html
│   │   │   ├── top.html
│   │   │   ├── whoknows.html
│   │   │   ├── world-light.html
│   │   │   └── world.html
│   │   └── index.js
│   │
│   ├── discogs/                  # Discogs API integration
│   │   ├── apis/
│   │   │   └── DiscogsApi.js
│   │   └── models/
│   │
│   ├── apple-music/              # Apple Music integration
│   │   ├── AppleMusicApi.js
│   │   ├── AppleMusicAltApi.js
│   │   ├── AppleMusicJwtGenerator.js
│   │   ├── AppleMusicVideoService.js
│   │   ├── converters/
│   │   ├── enums/
│   │   └── models/
│   │
│   ├── subscriptions/            # Supporter/subscription management
│   │   ├── services/
│   │   │   ├── OpenCollectiveService.js
│   │   │   └── DiscordSkuService.js
│   │   └── models/
│   │
│   ├── domain/                   # Shared domain models
│   │   ├── constants.js          # App constants
│   │   ├── publicProperties.js   # Global state
│   │   ├── statistics.js         # Prometheus metrics
│   │   ├── models/               # Domain models
│   │   │   ├── AlbumInfo.js
│   │   │   ├── ArtistInfo.js
│   │   │   ├── TrackInfo.js
│   │   │   ├── BotSettings.js
│   │   │   ├── RecentTrack.js
│   │   │   ├── TopArtist.js
│   │   │   ├── TopAlbum.js
│   │   │   ├── TopTrack.js
│   │   │   └── Shortcut.js
│   │   ├── enums/
│   │   ├── extensions/
│   │   ├── flags/
│   │   └── types/
│   │
│   ├── grpc/                     # gRPC client services
│   │   ├── protos/               # Protobuf definitions (reuse .proto files)
│   │   ├── clients/
│   │   │   ├── TimeEnrichmentClient.js
│   │   │   ├── StatusClient.js
│   │   │   ├── CensorClient.js
│   │   │   ├── AlbumEnrichmentClient.js
│   │   │   ├── ArtistEnrichmentClient.js
│   │   │   ├── TrackEnrichmentClient.js
│   │   │   ├── SupporterLinkClient.js
│   │   │   ├── EurovisionClient.js
│   │   │   └── IdResolutionClient.js
│   │   └── index.js
│   │
│   └── tests/                    # Test suite
│       ├── helpers/
│       │   └── TestHelpers.js
│       ├── musicbot/
│       │   ├── JockieMusicBot.test.js
│       │   ├── MakiMusicBot.test.js
│       │   ├── GreenBotMusicBot.test.js
│       │   └── ... (8 test files)
│       ├── GameService.test.js
│       ├── PlayService.test.js
│       └── TrackService.test.js
│
├── configs/
│   ├── config.example.json       # Example configuration
│   └── .env.example              # Environment variables template
│
├── docker/
│   ├── Dockerfile                # Multi-stage Docker build
│   ├── docker-compose-local.yml  # Local development (2 instances)
│   ├── docker-compose-beta.yml   # Beta environment
│   └── docker-compose-prod.yml   # Production (12 instances, 640 shards)
│
├── .github/
│   ├── workflows/
│   │   ├── nodejs.yml            # Build & test workflow
│   │   ├── docker-publish.yml    # Docker image publishing
│   │   └── codeql-analysis.yml   # Security analysis
│   └── FUNDING.yml
│
├── package.json                  # Project dependencies
├── pnpm-lock.yaml                # Lock file
├── .prettierrc                   # Code formatting
├── .eslintrc.json                # Linting rules
├── vite.config.js                # Test configuration (if using Vitest)
├── README.md
├── CONTRIBUTING.md
├── SECURITY.md
└── PLAN.md                       # This file
```

---

## Implementation Phases

### Phase 1: Foundation & Infrastructure (Weeks 1-2)

#### 1.1 Project Setup
- [ ] Initialize Node.js project with pnpm
- [ ] Configure ESLint + Prettier
- [ ] Set up tsconfig.json (if using TypeScript)
- [ ] Create base directory structure
- [ ] Set up Vite + Vitest for testing
- [ ] Configure GitHub Actions for Node.js CI/CD

#### 1.2 Database Layer
- [ ] Install and configure Prisma ORM
- [ ] Convert EF Core models to Prisma schema (48 entities)
- [ ] Set up PostgreSQL connection with citext and pg_trgm extensions
- [ ] Create base repository pattern
- [ ] Implement UserRepository (most complex)
- [ ] Implement initial migrations from existing SQL

#### 1.3 Configuration & Environment
- [ ] Set up dotenv for configuration
- [ ] Create config validation with zod
- [ ] Migrate ConfigData.cs to JavaScript
- [ ] Migrate BotSettings.cs models

#### 1.4 Logging & Metrics
- [ ] Configure Pino logger
- [ ] Set up prom-client for Prometheus metrics
- [ ] Migrate 60+ Prometheus metrics from Statistics.cs
- [ ] Create structured logging middleware

#### 1.5 Domain Models & Constants
- [ ] Migrate all domain models from FMBot.Domain
- [ ] Migrate constants from Constants.cs
- [ ] Migrate enums (19 files)
- [ ] Set up global state management

**Deliverables:**
- Working project structure
- Database connection with Prisma
- Config system with validation
- Logging and metrics operational

---

### Phase 2: Core Discord Bot (Weeks 3-4)

#### 2.1 Discord Client Setup
- [ ] Install and configure discord.js v14
- [ ] Set up sharded client (supports 640 shards)
- [ ] Implement shard range configuration via env vars
- [ ] Create Discord client event handlers
- [ ] Set up command registration system
- [ ] Configure interaction handling

#### 2.2 Command Framework
- [ ] Create text command handler (CommandHandler.js)
- [ ] Create slash command handler (InteractionHandler.js)
- [ ] Implement command attribute system (decorators)
  - [ ] GuildOnly
  - [ ] RequiresIndex
  - [ ] ServerStaffOnly
  - [ ] SupporterEnhanced
  - [ ] SupporterExclusive
  - [ ] UsernameSetRequired
  - [ ] UserSessionRequired
- [ ] Implement response builder pattern
- [ ] Create ContextModel for command context

#### 2.3 User Management
- [ ] Implement UserService
  - [ ] User registration/login
  - [ ] Last.fm username linking
  - [ ] User settings management
  - [ ] Playcount tracking
- [ ] Implement FmSettingService
- [ ] Create UserBuilder for Discord embeds

#### 2.4 Last.fm Integration
- [ ] Create LastfmApi client with all API methods
- [ ] Implement LastFmRepository for caching
- [ ] Create domain models for Last.fm responses
- [ ] Implement rate limiting and error handling
- [ ] Set up SmallIndexRepository

**Deliverables:**
- Discord bot connects and handles sharding
- Basic text and slash commands functional
- User registration with Last.fm working
- Last.fm API integration operational

---

### Phase 3: Core Features (Weeks 5-7)

#### 3.1 WhoKnows System
- [ ] Implement base WhoKnowsService
- [ ] Implement WhoKnowsArtistService
- [ ] Implement WhoKnowsAlbumService
- [ ] Implement WhoKnowsTrackService
- [ ] Implement WhoKnowsPlayService
- [ ] Implement WhoKnowsFilterService
- [ ] Create response builders
- [ ] Add pagination and button interactions

#### 3.2 Top Charts & Statistics
- [ ] Implement ChartService
- [ ] Implement TopCommands (/top, .top)
- [ ] Support time periods: weekly, monthly, quarterly, yearly, all-time
- [ ] Create ChartBuilder for embeds
- [ ] Implement autocomplete for search fields

#### 3.3 Artist/Album/Track Commands
- [ ] Implement ArtistsService
- [ ] Implement AlbumService
- [ ] Implement TrackService
- [ ] Create info embeds with images
- [ ] Implement metadata caching
- [ ] Add button interactions (pagination, details)

#### 3.4 Crown System
- [ ] Implement CrownService
- [ ] Create crown tracking in database
- [ ] Implement crown commands
- [ ] Create CrownBuilder for crown displays
- [ ] Add crown interaction handlers

#### 3.5 Friends System
- [ ] Implement FriendsService
- [ ] Friend relationship management
- [ ] Compare stats with friends
- [ ] Create FriendBuilder
- [ ] Add friend interaction handlers

**Deliverables:**
- WhoKnows commands fully functional
- Top charts working for all time periods
- Artist/album/track info commands working
- Crown system operational
- Friends system working

---

### Phase 4: Advanced Features (Weeks 8-10)

#### 4.1 Music Bot Scrobbling
- [ ] Implement MusicBotService
- [ ] Detect "Now Playing" messages from:
  - [ ] Jockie Music
  - [ ] Maki
  - [ ] GreenBot
  - [ ] Other music bots (8 total)
- [ ] Parse song information from messages
- [ ] Auto-scrobble to Last.fm
- [ ] Create comprehensive tests (8 test files)

#### 4.2 Import System
- [ ] Implement ImportService
- [ ] Spotify full history import
- [ ] Apple Music full history import
- [ ] Create ImportBuilder
- [ ] Add import interaction handlers
- [ ] Progress tracking and error handling

#### 4.3 Discogs Integration
- [ ] Implement DiscogsService
- [ ] DiscogsApi client
- [ ] User Discogs linking
- [ ] Release metadata caching
- [ ] Create DiscogsBuilder
- [ ] Add Discogs commands

#### 4.4 Apple Music Integration
- [ ] Implement AppleMusicApi client
- [ ] AppleMusicAltApi for alternative endpoints
- [ ] AppleMusicJwtGenerator for JWT generation
- [ ] AppleMusicVideoService
- [ ] Create AppleMusicCommands
- [ ] Add AppleMusic interaction handlers

#### 4.5 YouTube Integration
- [ ] Implement YoutubeService
- [ ] YouTube API integration (Google APIs)
- [ ] Music video search
- [ ] Create YoutubeCommands
- [ ] Add YouTube interaction handlers

#### 4.6 Spotify Integration
- [ ] SpotifyAPI.Web replacement
- [ ] Metadata enrichment
- [ ] Create SpotifyCommands

**Deliverables:**
- Music bot scrobbling working (8 bots supported)
- Import system functional (Spotify + Apple Music)
- Discogs integration working
- Apple Music features operational
- YouTube integration working

---

### Phase 5: Image Generation & AI (Weeks 11-12)

#### 5.1 Puppeteer Setup
- [ ] Install and configure Puppeteer
- [ ] Set up headless Chrome in Docker
- [ ] Create PuppeteerService for rendering
- [ ] Migrate HTML templates:
  - [ ] receipt.html
  - [ ] top.html
  - [ ] whoknows.html
  - [ ] world-light.html
  - [ ] world.html

#### 5.2 Image Processing
- [ ] Install and configure sharp
- [ ] Replace SkiaSharp functionality
- [ ] Image manipulation utilities
- [ ] Font rendering with canvas

#### 5.3 AI Features
- [ ] Implement OpenAiService
- [ ] OpenAI API integration
- [ ] AI generation commands
- [ ] Prompt management

#### 5.4 MusicBrainz Integration
- [ ] Implement MusicBrainzService
- [ ] Metadata enrichment
- [ ] API integration

**Deliverables:**
- Image generation working (charts, whoknows, world maps)
- AI features functional
- MusicBrainz metadata working

---

### Phase 6: Background Jobs & Scheduling (Week 13)

#### 6.1 Redis & BullMQ Setup
- [ ] Install Redis
- [ ] Set up BullMQ for job queues
- [ ] Replace Hangfire functionality

#### 6.2 Background Jobs
- [ ] User update queue (UpdateQueueHandler)
- [ ] User index queue (IndexService)
- [ ] Timer service (TimerService)
- [ ] Featured user rotation (FeaturedService)
- [ ] Bot list updates (top.gg, etc.)

#### 6.3 Scheduled Tasks
- [ ] Implement cron jobs
- [ ] Migrate all TimerService tasks
- [ ] Error handling and retries

**Deliverables:**
- All background jobs operational
- Scheduled tasks running
- Queue processing working

---

### Phase 7: gRPC & External Services (Week 14)

#### 7.1 gRPC Client Setup
- [ ] Install @grpc/grpc-js
- [ ] Reuse existing .proto files
- [ ] Implement gRPC clients:
  - [ ] TimeEnrichmentClient
  - [ ] StatusClient
  - [ ] CensorClient
  - [ ] AlbumEnrichmentClient
  - [ ] ArtistEnrichmentClient
  - [ ] TrackEnrichmentClient
  - [ ] SupporterLinkClient
  - [ ] EurovisionClient
  - [ ] IdResolutionClient

#### 7.2 Subscription Management
- [ ] Implement SupporterService
- [ ] OpenCollectiveService (GraphQL)
- [ ] DiscordSkuService for Discord SKU integration
- [ ] Stripe integration

#### 7.3 Eurovision Service
- [ ] Implement EurovisionService
- [ ] Create EurovisionBuilder

#### 7.4 ID Resolution
- [ ] Implement IdResolutionService
- [ ] Entity ID resolution

**Deliverables:**
- All gRPC services connected
- Subscription management working
- External services operational

---

### Phase 8: Moderation & Admin Features (Week 15)

#### 8.1 Moderation
- [ ] Implement CensorService
- [ ] BottedUsers detection
- [ ] GlobalWhoKnowsFilterService
- [ ] GuildBlockedUsers
- [ ] Content moderation

#### 8.2 Admin Features
- [ ] Implement AdminService
- [ ] Server settings management
- [ ] Channel settings
- [ ] Disabled commands
- [ ] Emote reactions

#### 8.3 Shortcuts & Templates
- [ ] Implement ShortcutService
- [ ] User shortcuts
- [ ] Guild shortcuts
- [ ] Implement TemplateService
- [ ] Command output templates

#### 8.4 Server Indexing
- [ ] Implement GuildIndexService
- [ ] Server member caching
- [ ] Index commands

**Deliverables:**
- Moderation features working
- Admin tools functional
- Shortcuts and templates operational
- Server indexing working

---

### Phase 9: Games & Additional Features (Week 16)

#### 9.1 Jumble Game
- [ ] Implement GameService
- [ ] JumbleSessions
- [ ] JumbleSessionAnswers
- [ ] JumbleSessionHints
- [ ] Create GameBuilder
- [ ] Game interaction handlers

#### 9.2 Featured User
- [ ] Implement FeaturedService
- [ ] Rotating bot profile picture
- [ ] FeaturedLogs tracking

#### 9.3 Country & Genre Stats
- [ ] Implement CountryService
- [ ] Implement GenreService
- [ ] Country commands
- [ ] Genre commands
- [ ] Country/Genre builders

#### 9.4 User Streaks
- [ ] Implement streak tracking
- [ ] Listening streaks

#### 9.5 Track Synced Lyrics
- [ ] Implement lyrics storage
- [ ] Synced lyrics display

**Deliverables:**
- Jumble game working
- Featured user rotating
- Country/genre stats working
- Streaks tracking operational

---

### Phase 10: Testing & Quality Assurance (Week 17)

#### 10.1 Unit Tests
- [ ] Write tests for all services (38 services)
- [ ] Music bot scrobbling tests (8 bots)
- [ ] GameService tests
- [ ] PlayService tests
- [ ] TrackService tests
- [ ] Repository tests

#### 10.2 Integration Tests
- [ ] Discord interaction tests
- [ ] Last.fm API tests
- [ ] Database integration tests
- [ ] gRPC client tests

#### 10.3 Code Quality
- [ ] Run ESLint with strict rules
- [ ] Set up code coverage reporting
- [ ] Review and refactor code
- [ ] Document all public APIs with JSDoc

**Deliverables:**
- Comprehensive test suite
- Code coverage > 80%
- All linting checks passing
- Well-documented codebase

---

### Phase 11: Docker & Deployment (Week 18)

#### 11.1 Docker Configuration
- [ ] Create multi-stage Dockerfile
- [ ] Include Chrome/Puppeteer setup
- [ ] Install ffmpeg and dependencies
- [ ] Optimize image size

#### 11.2 Docker Compose
- [ ] docker-compose-local.yml (2 instances, 12 shards)
- [ ] docker-compose-beta.yml (beta environment)
- [ ] docker-compose-prod.yml (12 instances, 640 shards)

#### 11.3 CI/CD Pipeline
- [ ] GitHub Actions workflow
- [ ] Build and test on push/PR
- [ ] Docker image publishing to GHCR
- [ ] CodeQL security analysis

#### 11.4 Health Checks
- [ ] Implement health check endpoint
- [ ] Docker HEALTHCHECK configuration
- [ ] Monitoring and alerting

**Deliverables:**
- Docker images building successfully
- Local development working
- Beta environment operational
- Production deployment ready

---

### Phase 12: Migration & Launch (Weeks 19-20)

#### 12.1 Data Migration
- [ ] Migrate PostgreSQL database
- [ ] Run Prisma migrations
- [ ] Verify data integrity
- [ ] Performance testing

#### 12.2 Beta Testing
- [ ] Deploy to beta environment
- [ ] Test all features
- [ ] Bug fixes and improvements
- [ ] Load testing

#### 12.3 Production Launch
- [ ] Gradual shard rollout
- [ ] Monitor metrics and errors
- [ ] User feedback collection
- [ ] Final optimizations

#### 12.4 Documentation
- [ ] Update README.md
- [ ] Update CONTRIBUTING.md
- [ ] Create developer guide
- [ ] Create user guide
- [ ] API documentation

**Deliverables:**
- Fully migrated production system
- All features working identically to C# version
- Comprehensive documentation
- Successful launch

---

## Database Migration Strategy

### Prisma Schema Conversion

Convert all 48 EF Core entities to Prisma models:

```prisma
// Example: Users entity conversion
model Users {
  userId        BigInt    @id @map("user_id")
  discordId     BigInt    @map("discord_id")
  userName      String?   @map("user_name")
  sessionKey    String?   @map("session_key")
  playcount     Int       @default(0)
  ...
  userArtists   UserArtist[]
  userAlbums    UserAlbum[]
  userTracks    UserTrack[]
  userPlays     UserPlay[]
  userCrowns    UserCrown[]
  ...
  
  @@map("users")
  @@index([discordId])
  @@index([userName])
}
```

### Migration Steps
1. Export existing PostgreSQL schema
2. Create Prisma schema with all 48 entities
3. Use `prisma db pull` to introspect existing database
4. Generate Prisma client with `prisma generate`
5. Create initial migration: `prisma migrate dev`
6. Test with existing data
7. Incremental migrations for schema changes

### Key Considerations
- Maintain snake_case column naming (from EF Core naming conventions)
- Preserve PostgreSQL extensions: citext (case-insensitive text), pg_trgm (trigram search)
- Keep all existing indexes and constraints
- Handle BigInt fields (Discord snowflakes)
- Preserve JSON/JSONB columns

---

## Discord.js Migration Notes

### NetCord → discord.js Mapping

| NetCord Feature | discord.js Equivalent |
|-----------------|----------------------|
| `ShardedGatewayClient` | `ShardClientUtil` + `Client` |
| `SlashCommandModule` | `REST` for command registration |
| `InteractionModule` | `interactionCreate` event |
| `ComponentModule` | `interactionCreate` with customId |
| `AutocompleteModule` | `interactionCreate` with type=APPLICATION_COMMAND_AUTOCOMPLETE |
| `ModulePrecondition` (attributes) | Custom decorators or middleware |
| `EmbedBuilder` (NetCord) | `EmbedBuilder` (discord.js) |
| `ComponentBuilder` | `ActionRowBuilder` + button/select builders |
| `CommandContext` | `ChatInputCommandInteraction` or `Message` |

### Sharding Strategy
```javascript
// Maintain same sharding as production
// docker-compose-prod.yml: 12 instances, 640 shards total
// Each instance handles ~53 shards

const { ShardingManager } = require('discord.js');

const manager = new ShardingManager('./bot.js', {
  token: process.env.DISCORD_TOKEN,
  totalShards: parseInt(process.env.SHARDS_TOTAL_SHARDS) || 640,
  shardList: getShardRange(), // Calculate from FIRST_SHARD to LAST_SHARD
  mode: 'process',
});

await manager.spawn();
```

---

## Background Jobs Migration (Hangfire → BullMQ)

### Job Queue Mapping

| Hangfire Feature | BullMQ Equivalent |
|------------------|-------------------|
| `BackgroundJob.Enqueue()` | `queue.add()` |
| `RecurringJob.AddOrUpdate()` | `queue.add()` with repeat options |
| `BackgroundJob.ContinueJobWith()` | Job dependencies/flows |
| Hangfire Dashboard | BullMQ Arena or custom UI |
| Retry logic | Built-in retry with backoff |

### Implementation
```javascript
import { Queue, Worker, QueueScheduler } from 'bullmq';
import IORedis from 'ioredis';

const connection = new IORedis(process.env.REDIS_URL);

// User update queue
const userUpdateQueue = new Queue('user-updates', { connection });
const userUpdateWorker = new Worker('user-updates', async job => {
  await updateUser(job.data.userId);
}, { connection, concurrency: 10 });

// Recurring jobs (timer service)
await timerQueue.add('update-featured-user', {}, {
  repeat: { pattern: '0 */6 * * *' } // Every 6 hours
});
```

---

## Image Generation Migration

### PuppeteerSharp → Puppeteer
```javascript
// Current (C#)
using var browser = await Puppeteer.LaunchAsync(options);
using var page = await browser.NewPageAsync();
await page.SetContentAsync(html);
var screenshot = await page.ScreenshotAsync();

// Target (JavaScript)
const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.setContent(html);
const screenshot = await page.screenshot();
await browser.close();
```

### SkiaSharp → sharp
```javascript
// Current (C#)
using var bitmap = SKBitmap.Decode(imageData);
using var canvas = new SKCanvas(bitmap);
canvas.DrawText(text, x, y, paint);

// Target (JavaScript)
const image = await sharp(imageData)
  .composite([{ input: textOverlay, top: y, left: x }])
  .toBuffer();
```

---

## Key Technical Decisions

### 1. TypeScript vs Pure JavaScript
**Recommendation: Use TypeScript**
- Better type safety (equivalent to C# nullable reference types)
- Easier migration from strongly-typed C# code
- Better IDE support and refactoring
- Catches errors at compile time

### 2. discord.js vs Eris vs OceanicJS
**Recommendation: discord.js v14**
- Largest community and documentation
- Most stable and well-maintained
- Better documentation and examples
- Easier to find help

### 3. Prisma vs Sequelize vs Knex
**Recommendation: Prisma + raw pg for complex queries**
- Type-safe queries (if using TypeScript)
- Excellent PostgreSQL support
- Easy migrations
- Use raw pg/Dapper-like queries for performance-critical operations

### 4. BullMQ vs Agenda vs node-cron
**Recommendation: BullMQ + Redis**
- Most robust for production workloads
- Built-in retry, monitoring, clustering
- Redis-based (can scale across instances)
- Replace node-cron for simple scheduled tasks

### 5. Testing: Vitest vs Jest
**Recommendation: Vitest**
- Faster execution
- Better TypeScript support
- Native ESM support
- Compatible with Jest API

---

## Performance Considerations

### Caching Strategy
- Use Redis for caching frequently accessed data
- Cache Last.fm API responses
- Cache user/server metadata
- Implement cache invalidation strategy

### Database Optimization
- Use pg_trgm for full-text search on artist/album names
- Use citext for case-insensitive username comparisons
- Optimize indexes based on query patterns
- Use connection pooling (PgBouncer)

### Memory Management
- Implement pagination for large result sets
- Stream large datasets instead of loading all into memory
- Monitor memory usage with Prometheus
- Set appropriate heap size for Node.js

### Sharding Considerations
- Each shard group runs in separate Docker container
- Share Redis connection for stateless operation
- Implement rate limiting per shard group
- Monitor shard health and performance

---

## Migration Risks & Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Feature parity | High | Comprehensive test suite, beta testing |
| Data migration | High | Incremental migration, rollback plan |
| Performance degradation | Medium | Load testing, profiling, optimization |
| Breaking changes in dependencies | Medium | Lock dependency versions, monitor changelogs |
| gRPC service compatibility | Medium | Test with existing gRPC servers |
| Image generation differences | Low | Visual regression testing |
| Discord API rate limits | Medium | Implement proper rate limiting, queue requests |
| Learning curve for team | Medium | Documentation, code reviews, pair programming |

---

## Success Criteria

1. **Feature Parity:** All features from C# version implemented and tested
2. **Performance:** Equal or better response times, memory usage within limits
3. **Reliability:** 99.9% uptime in production, comprehensive error handling
4. **Test Coverage:** >80% code coverage, all critical paths tested
5. **Scalability:** Support 640 shards across 12 instances
6. **Maintainability:** Well-documented, clean code, easy to extend
7. **Zero Data Loss:** All existing user data migrated successfully
8. **Backward Compatibility:** Commands and features work identically for users

---

## Team & Resource Requirements

- **Developers:** 2-3 full-stack developers (JavaScript/Node.js experience)
- **Duration:** 20 weeks (5 months) full-time
- **Infrastructure:** Redis cluster, PostgreSQL, Docker environment
- **Testing:** Beta Discord server for user testing
- **Tools:** GitHub Actions, GHCR, monitoring (Prometheus + Grafana)

---

## Post-Launch Considerations

1. **Monitoring & Alerting**
   - Set up Grafana dashboards for metrics
   - Configure alerts for errors, high latency, memory usage
   - Monitor shard performance

2. **User Communication**
   - Announce migration to users
   - Provide changelog
   - Collect feedback

3. **Rollback Plan**
   - Keep C# version running in parallel initially
   - Database backups before migration
   - Quick rollback procedure if critical issues

4. **Future Enhancements**
   - Consider microservices architecture for specific features
   - Evaluate serverless options for image generation
   - Add more AI/ML features
   - Expand music bot support

---

## Appendix

### A. Current File Count by Category
- Total .cs files: ~484
- Total .proto files: 11
- Total HTML templates: 5
- Database entities: 48
- Services: 38
- Response builders: 21
- Text commands: 16
- Slash command files: 21
- Component interactions: 16
- Repository interfaces: 6
- Test files: 13

### B. External API Dependencies
- Last.fm (core music data)
- Spotify (images, metadata, imports)
- Apple Music (metadata, videos, imports)
- YouTube (music videos)
- Discogs (record collections)
- MusicBrainz (metadata)
- Genius (lyrics)
- OpenAI (AI features)
- OpenCollective (supporter management)
- Discord (gateway, REST API)

### C. Database Extensions Used
- citext: Case-insensitive text type
- pg_trgm: Trigram-based text search

### D. Prometheus Metrics (60+)
- Active users, registered users, premium servers
- Command usage, API calls, response times
- Queue sizes, job durations
- Database query times
- Image generation metrics
- Music bot scrobbles
- And more...

---

**Last Updated:** April 14, 2026  
**Status:** Planning Phase  
**Version:** 1.0
