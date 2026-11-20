import { Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { usernameSchema } from "@wa/protocol";
import { ChatRepository } from "./chat.repository.js";

@Injectable()
export class UsersService {
  // Users are never deleted, so a positive answer can be cached forever.
  private readonly known = new Set<string>();

  constructor(@Inject(ChatRepository) private readonly repo: ChatRepository) {}

  async register(username: string): Promise<{ username: string; created: boolean }> {
    const created = await this.repo.registerUser(username);
    this.known.add(username);
    return { username, created };
  }

  async missing(usernames: string[]): Promise<string[]> {
    const unknown = [...new Set(usernames)].filter((u) => !this.known.has(u));
    const found = await this.repo.usersExist(unknown);
    for (const u of found) this.known.add(u);
    return unknown.filter((u) => !found.has(u));
  }

  async exists(username: string): Promise<boolean> {
    return (await this.missing([username])).length === 0;
  }

  // The caller as named by the x-username header (there is no login).
  async caller(header: string | undefined): Promise<string> {
    const parsed = usernameSchema.safeParse(header ?? "");
    if (!parsed.success) throw new UnauthorizedException("x-username header missing or invalid");
    if (!(await this.exists(parsed.data))) throw new UnauthorizedException("unknown user");
    return parsed.data;
  }

  async require(username: string): Promise<void> {
    if (!(await this.exists(username))) throw new NotFoundException(`no user ${username}`);
  }
}
