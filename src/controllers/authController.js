function _decodeCredentials(header) {
  try {
    const base64Part = header.trim().replace(/^Basic\s+/i, "");
    const clean = base64Part.replace(/^Basic\s+/i, "");

    const decoded = Buffer.from(clean, "base64").toString("ascii");
    const [username, password] = decoded.split(":");
    return [username, password];
  } catch (err) {
    console.error("Failed to decode credentials:", err);
    return [];
  }
}

function basicToken(username, password) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
}

const login = async (req, res) => {
  const username = req.body.username;
  const password = req.body.password;

  // Basic validation
  if (!username || !password) {
    console.log("Missing username or password in login request");
    return res.status(400).json({ error: "Username and password are required" });
  }

  if (!process.env.DBFUSE_USERNAME || !process.env.DBFUSE_PASSWORD) {
    console.log("No env variables set, allowing login without validation");
    return res.status(200).json({ basicToken: basicToken(username, username) }); // Dummy token
  }

  if (username === process.env.DBFUSE_USERNAME && password === process.env.DBFUSE_PASSWORD) {
    return res.status(200).json({ basicToken: basicToken(username, password) });
  }

  // Invalid credentials
  console.warn("Invalid credentials provided");
  return res.status(401).json({ error: "Invalid username or password" });
};

const logout = async (req, res) => {
  return res.status(200).json({ message: "Logged out successfully" });
};

const isAuthenticated = async (req, res) => {
  if (!process.env.DBFUSE_USERNAME || !process.env.DBFUSE_PASSWORD) {
    console.log("No env variables set, returning authenticated without validation");
    return res.status(200).json({ authenticated: true });
  }

  const [username, password] = _decodeCredentials(req.headers.authorization || "");
  console.log("username:", username);
  console.log("password:", password);
  if (username === process.env.DBFUSE_USERNAME && password === process.env.DBFUSE_PASSWORD) {
    console.log("User is authenticated");
    return res.status(200).json({ authenticated: true });
  }
  return res.status(401).json({ authenticated: false });
};

module.exports = {
  login,
  logout,
  isAuthenticated,
  _decodeCredentials,
};
