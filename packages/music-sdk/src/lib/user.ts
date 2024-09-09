import { AxiosResponse } from "axios";
import axios from "./axios";
import { User } from "./types";

/**
 * Change the password for a user.
 * @param {string} username - The username of the user.
 * @param {string} currentPassword - The current password of the user.
 * @param {string} newPassword - The new password for the user.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function changePassword(username: string, currentPassword: string, newPassword: string): Promise<string> {
  const response = await axios.post('/user/change_password', {
    username,
    current_password: currentPassword,
    new_password: newPassword,
  });
  return response.data;
}

/**
 * Get the listen history for a user.
 * @param {number} userId - The ID of the user.
 * @returns {Promise<any[]>} - A promise that resolves to the listen history.
 */
export async function getListenHistory(userId: number): Promise<any[]> {
  const response = await axios.get('/user/get_listen_history', {
    params: { user_id: userId },
  });
  return response.data;
}

/**
 * Add a song to the listen history for a user.
 * @param {number} userId - The ID of the user.
 * @param {string} songId - The ID of the song.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function addSongToListenHistory(userId: number, songId: string): Promise<string> {
  const response = await axios.post('/user/add_song_to_listen_history', {
    user_id: userId,
    song_id: songId,
  });
  return response.data;
}

/**
 * Set the bitrate for a user.
 * @param {number} userId - The ID of the user.
 * @param {number} bitrate - The bitrate to set.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function setBitrate(userId: number, bitrate: number): Promise<string> {
  const response = await axios.post('/user/set_bitrate', {
    user_id: userId,
    bitrate,
  });
  return response.data;
}

/**
 * Set the now playing song for a user.
 * @param {number} userId - The ID of the user.
 * @param {string} nowPlaying - The ID of the now playing song.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function setNowPlaying(userId: number, nowPlaying: string): Promise<string> {
  const response = await axios.post('/user/set_now_playing', {
    user_id: userId,
    now_playing: nowPlaying,
  });
  return response.data;
}

/**
 * Get the now playing song for a user.
 * @param {number} userId - The ID of the user.
 * @returns {Promise<{ now_playing: number | null }>} - A promise that resolves to the now playing song.
 */
export async function getNowPlaying(userId: number): Promise<{ now_playing: number | null }> {
  const response = await axios.get('/user/get_now_playing', {
    params: { user_id: userId },
  });
  return response.data;
}

/**
 * Get user information by username.
 * @param {string} username - The username of the user.
 * @returns {Promise<User>} - A promise that resolves to the user information.
 */
export async function getUserInfo(username: string): Promise<User> {
  const response: AxiosResponse<User> = await axios.get(`/user/info_by_username/${username}`);
  return response.data;
}

/**
 * Get user information by ID.
 * @param {number} id - The ID of the user.
 * @returns {Promise<User>} - A promise that resolves to the user information.
 */
export async function getUserInfoById(id: number): Promise<User> {
  const response: AxiosResponse<User> = await axios.get(`/user/info_by_id/${id}`);
  return response.data;
}

/**
 * Get the profile picture for a user.
 * @param {number} userId - The ID of the user.
 * @returns {Promise<Blob>} - A promise that resolves to the profile picture blob.
 */
export async function getProfilePicture(userId: number): Promise<Blob> {
  const response = await axios.get(`/user/profile_picture/${userId}`, {
    responseType: 'blob',
  });
  return response.data;
}

/**
 * Upload a profile picture for a user.
 * @param {number} userId - The ID of the user.
 * @param {File} file - The profile picture file to upload.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function uploadProfilePicture(userId: number, file: File): Promise<string> {
  const formData = new FormData();
  formData.append('picture', file);

  const response = await axios.post(`/user/profile_picture/${userId}`, formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
}