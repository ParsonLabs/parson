import axios from './axios';

/**
 * Follow a user.
 * @param {number} followerId - The ID of the follower.
 * @param {number} followingId - The ID of the user to be followed.
 * @returns {Promise<string>} - A promise that resolves to a success message.
 */
export async function follow(followerId: number, followingId: number): Promise<string> {
  const response = await axios.post('/social/follow', {
    follower_id: followerId,
    following_id: followingId,
  });
  return response.data;
}

/**
 * Get the followers of a user.
 * @param {number} userId - The ID of the user whose followers are to be retrieved.
 * @returns {Promise<number[]>} - A promise that resolves to a list of follower IDs.
 */
export async function getFollowers(userId: number): Promise<number[]> {
  const response = await axios.get(`/social/followers/${userId}`);
  return response.data;
}

/**
 * Get the users that a user is following.
 * @param {number} userId - The ID of the user whose following list is to be retrieved.
 * @returns {Promise<number[]>} - A promise that resolves to a list of following IDs.
 */
export async function getFollowing(userId: number): Promise<number[]> {
  const response = await axios.get(`/social/following/${userId}`);
  return response.data;
}