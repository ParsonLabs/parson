export type User = {
	id: number;
	name?: string;
	username: string;
	password: string;
	image?: string;
	bitrate: number;
	createdAt: Date;
	updatedAt: Date;
	nowPlaying?: number;
};

export type NewUser = {
	username: string;
	password: string;
};

export type SearchItem = {
	id: number;
	userId: number;
	search: string;
	createdAt: Date;
};

export type NewSearchItem = {
	userId: number;
	search: string;
};

export type ListenHistoryItem = {
	id: number;
	userId: number;
	songId: string;
	listenedAt: Date;
};

export type NewListenHistoryItem = {
	userId: number;
	songId: string;
};

export type Follow = {
	id: number;
	followerId: number;
	followingId: number;
};

export type NewFollow = {
	followerId: number;
	followingId: number;
};

export type Playlist = {
	id: number;
	name: string;
	createdAt: Date;
	updatedAt: Date;
};

export type Song = {
	id: number;
};

export type PlaylistToUser = {
	a: number;
	b: number;
};

export type PlaylistToSong = {
	a: number;
	b: number;
};

export type Account = {
	id: string;
	userId: number;
	providerType: string;
	providerId: string;
	providerAccountId: string;
	plm_refreshToken?: string;
	plm_accessToken?: string;
	plm_accessTokenExpires?: Date;
	createdAt: Date;
	updatedAt: Date;
};

export type Session = {
	id: string;
	userId: number;
	expires: Date;
	sessionToken: string;
	plm_accessToken: string;
	createdAt: Date;
	updatedAt: Date;
};

export interface Artist {
  id: string;
  name: string;
  icon_url: string;
  followers: number;
  albums: Album[];
  featured_on_album_ids: string[];
  description: string;
  tadb_music_videos?: string;
}

export interface Album {
    id: string;
    name: string;
    cover_url: string;
    songs: LibrarySong[];
    first_release_date: string;
    musicbrainz_id: string;
    wikidata_id: string | null;
    primary_type: string;
    description: string;
    contributing_artists: string[];
    contributing_artists_ids: string[];
    release_album?: ReleaseAlbum;
    release_group_album?: ReleaseGroupAlbum;
}

export interface LibrarySong {
    id: string;
    name: string;
    artist: string;
    contributing_artists: string[];
    contributing_artist_ids: string[];
    track_number: number;
    path: string;
    duration: number;
    artist_object: Artist;
    album_object: Album;
    music_video?: MusicVideo;
}

export interface BareSong {
    id: string;
    name: string;
    artist: string;
    contributing_artists: string[];
    contributing_artist_ids: string[];
    track_number: number;
    path: string;
    duration: number;
    music_video?: MusicVideo;
}

export interface MusicVideo {
    url: string;
    thumbnail_url?: string;
    tadb_track_id: string;
    tadb_album_id: string;
    description: string;
    musicbrainz_recording_id: string;
}

export interface ArtistInfo {
	id: string;
	name: string;
	icon_url?: string;
	followers?: number;
}

export interface AlbumInfo {
	id: string;
	name: string;
	cover_url?: string;
	first_release_date?: string;
}

export interface SongInfo {
	id: string;
	name: string;
	duration: number;
	path: string;
}

export interface CombinedItem {
  item_type: string;
  name: string;
  id: string;
  description?: string;
  acronym?: string;
  artist_object?: ArtistInfo;
  album_object?: AlbumInfo;
  song_object?: SongInfo;
}

export interface ServerInfo {
  local_address: string;
  server_name: string;
  version: string;
  product_name: string;
  startup_wizard_completed: boolean;
  login_disclaimer: string;
}

export interface ReleaseGroupAlbum {
    rating: Rating;
    artist_credit: CreditArtist[];
    relationships: Relationship[];
    releases: Information[];
    musicbrainz_id: string;
    first_release_date: string;
    title: string;
    aliases: Alias[];
    primary_type_id: string;
    annotation: string;
    tags: Tag[];
    genres: Genre[];
}

export interface ReleaseAlbum {
    information: Information;
    tracks: Track[];
    labels: Label[];
    relationships: Relationship[];
    musicbrainz_id: string;
    first_release_date: string;
    title: string;
    aliases: Alias[];
    primary_type_id: string;
    annotation: string;
    tags: Tag[];
    genres: Genre[];
}

export interface Information {
    date: string;
    country: string;
    status_id: string;
    title: string;
    barcode: string;
    quality: string;
    packaging: string;
    disambiguation: string;
    release_type: string;
    asin: string;
    music_brainz_id: string;
    packaging_id: string;
    status: string;
    tags: Tag[];
    genres: Genre[];
    cover_art_status: CoverArtStatus;
    collections: Collection[];
    artist_credits: CreditArtist[];
}

export interface TextRepresentation {
    script: string;
    language: string;
}

export interface CoverArtStatus {
    count: number;
    front: string;
    darkened: string;
    artwork: string;
    back: string;
}

export interface CreditArtist {
    name: string;
    join_phrase: string;
    musicbrainz_id: string;
    artist_type: string;
    disambiguation: string;
    genres: Genre[];
    aliases: Alias[];
}

export interface Genre {
    musicbrainz_id: string;
    disambiguation: string;
    name: string;
    count: number;
}

export interface Alias {
    begin: string;
    alias_type: string;
    sort_name: string;
    name: string;
    end: string;
    locale: string;
    ended: boolean;
    type_id: string;
    primary: string;
}

export interface Collection {
    entity_type: string;
    type_id: string;
    name: string;
    editor: string;
    release_count: number;
    id: string;
    collection_type: string;
    secondary_type_ids: string[];
    tags: Tag[];
    artist_credit: CreditArtist[];
    aliases: string[];
    secondary_types: string[];
    disambiguation: string;
    first_release_date: string;
}

export interface Track {
    length: number;
    artist_credit: CreditArtist[];
    track_name: string;
    position: number;
    video: boolean;
    first_release_date: string;
    number: string;
    musicbrainz_id: string;
    rating: Rating;
    tags: Tag[];
}

export interface Rating {
    votes_count: number;
    value: number;
}

export interface Tag {
    count: number;
    name: string;
}

export interface Label {
    catalog_number: string;
    type_id: string;
    name: string;
    sort_name: string;
    label_type: string;
    id: string;
    aliases: Alias[];
}

export interface Relationship {
    direction: string;
    type_id: string;
    ended: boolean;
    begin: string;
    purchase_relationship_type: string;
    musicbrainz_id: string;
    target_credit: string;
    source_credit: string;
    target_type: string;
    end: string;
    url: string;
}

export interface MusicVideoSong {
  id: string;
  name: string;
  artist: string;
  contributing_artists: string[];
  track_number: number;
  path: string;
  duration: number;
  music_video?: {
    url: string;
    thumbnail_url?: string;
    tadb_track_id: string;
    tadb_album_id: string;
    description: string;
    musicbrainz_recording_id: string;
  };
}