import request from '../utils/request';

interface LoginResponse {
  success: boolean;
  code: number;
  authToken?: string;
  user?: { name: string };
  userInfo?: { Badge?: string; Name?: string; IsAdmin?: boolean; SkillEnabled?: boolean; [key: string]: unknown };
  returnTo?: string;
}

export const loginApi = {
  completeLogin: (code: string, state: string) =>
    request.post<LoginResponse, LoginResponse>('/login', { code, state }),
};
