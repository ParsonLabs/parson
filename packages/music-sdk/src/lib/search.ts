import axios from './axios';
import { CombinedItem } from './types';

/**
 * Represents a request to add a search history item.
 */
interface AddSearchHistoryRequest {
  user_id: number;
  search: string;
}

/**
 * Represents a request to delete an item from search history.
 */
interface DeleteItemFromSearchHistoryRequest {
  id: number;
}

/**
 * Represents a request to get the last searched queries.
 */
interface GetLastSearchedQueriesRequest {
  user_id: number;
}

/**
 * Represents a search item response.
 */
interface SearchItemResponse {
  id: number;
  user_id: number;
  search: string;
  created_at: string;
}



/**
 * Represents an artist.
 */
interface Artist {
  name: string;
  id: string;
  albums: Album[];
}

/**
 * Represents an album.
 */
interface Album {
  name: string;
  id: string;
  songs: Song[];
}

/**
 * Represents a song.
 */
interface Song {
  name: string;
  id: string;
}

/**
 * Add a search history item.
 * @param {AddSearchHistoryRequest} item - The search history item to add.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function addSearchHistory(item: AddSearchHistoryRequest): Promise<string> {
  const response = await axios.post('/search/add_search_history', item);
  return response.data;
}

/**
 * Delete an item from search history.
 * @param {DeleteItemFromSearchHistoryRequest} item - The search history item to delete.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function deleteItemFromSearchHistory(item: DeleteItemFromSearchHistoryRequest): Promise<string> {
  const response = await axios.delete('/search/delete_item_from_search_history', {
    data: item,
  });
  return response.data;
}

/**
 * Get the last searched queries for a user.
 * @param {GetLastSearchedQueriesRequest} query - The query parameters.
 * @returns {Promise<SearchItemResponse[]>} - A promise that resolves to an array of search items.
 */
export async function getLastSearchedQueries(query: GetLastSearchedQueriesRequest): Promise<SearchItemResponse[]> {
  const response = await axios.get('/search/get_last_searched_queries', {
    params: query,
  });
  return response.data;
}

/**
 * Search the library.
 * @param {string} query - The query string.
 * @returns {Promise<CombinedItem[]>} - A promise that resolves to an array of combined items.
 */
export async function searchLibrary(query: string): Promise<CombinedItem[]> {
  const response = await axios.get('/search/library', {
    params: { q: query },
  });
  return response.data;
}

interface YouTubeVideoResponse {
  id: string;
  title: string;
  author: string;
}

/**
 * Search YouTube videos via Invidious API.
 * @param {string} query - The search query string.
 * @returns {Promise<YouTubeVideoResponse[]>} - A promise that resolves to an array of YouTube videos.
 */
export async function searchYouTube(query: string): Promise<YouTubeVideoResponse[]> {
  const response = await axios.get('/search/youtube', {
    params: { q: query },
  });
  return response.data;
}

export interface CommentInfo {
  commentCount: number
  videoId: string
  comments: Comment[]
  continuation: string
}

export interface Comment {
  authorId: string
  authorUrl: string
  author: string
  verified: boolean
  authorThumbnails: AuthorThumbnail[]
  authorIsChannelOwner: boolean
  isSponsor: boolean
  likeCount: number
  isPinned: boolean
  commentId: string
  content: string
  contentHtml: string
  isEdited: boolean
  published: number
  publishedText: string
  replies?: Replies
}

export interface AuthorThumbnail {
  url: string
  width: number
  height: number
}

export interface Replies {
  replyCount: number
  continuation: string
}

/**
 * Get comments for a YouTube video.
 * @param {string} videoId - The YouTube video ID.
 * @returns {Promise<YouTubeComment[]>} - A promise that resolves to an array of comments.
 * @throws {Error} If the request fails or returns an error.
 */
export async function getYouTubeComments(videoId: string): Promise<CommentInfo> {
  const response = await axios.get<CommentInfo>('/search/youtube/comments', {
    params: { video_id: videoId },
  });
  return response.data;
}