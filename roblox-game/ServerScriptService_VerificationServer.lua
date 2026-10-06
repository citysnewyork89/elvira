-- =========================================================
-- ELVIRA TECHNOLOGIES — Account verification + Hub info (SERVER)
-- Where to paste this: ServerScriptService > new Script
-- (Studio: right-click ServerScriptService > Insert Object > Script)
--
-- BEFORE PUBLISHING, check the two values below match your Vercel
-- deployment and the ROBLOX_GAME_SECRET env var there. Also go to
-- Home > Game Settings > Security and turn ON "Allow HTTP Requests".
-- =========================================================

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local HttpService = game:GetService("HttpService")

-- ---- EDIT THESE TWO VALUES IF THEY EVER CHANGE ----
local BACKEND_BASE_URL = "https://elvira-sigma.vercel.app/api/roblox"
local SHARED_SECRET = "PASTE_YOUR_ROBLOX_GAME_SECRET_HERE" -- same value as ROBLOX_GAME_SECRET in Vercel. Never commit the real one.
-- -----------------------------------------------------

local REDEEM_URL = BACKEND_BASE_URL .. "/code/redeem"
local STATUS_URL = BACKEND_BASE_URL .. "/status"
local HUB_INFO_URL = BACKEND_BASE_URL .. "/hub-info"

local function getOrCreateRemote(name)
	local remote = ReplicatedStorage:FindFirstChild(name)
	if not remote then
		remote = Instance.new("RemoteEvent")
		remote.Name = name
		remote.Parent = ReplicatedStorage
	end
	return remote
end

local verifyRemote = getOrCreateRemote("VerifyRobloxCode")
local verifyResult = getOrCreateRemote("VerifyRobloxCodeResult")
local getInitialState = getOrCreateRemote("GetInitialState")
local getInitialStateResult = getOrCreateRemote("GetInitialStateResult")
local checkHubStatus = getOrCreateRemote("CheckHubStatus")
local checkHubStatusResult = getOrCreateRemote("CheckHubStatusResult")

local function httpGet(url, headers)
	local ok, response = pcall(function()
		return HttpService:RequestAsync({ Url = url, Method = "GET", Headers = headers })
	end)
	if not ok or not response.Success then
		return nil
	end
	local decodedOk, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)
	if not decodedOk then
		return nil
	end
	return decoded
end

local function fetchHubInfo()
	local decoded = httpGet(HUB_INFO_URL, { ["x-elvira-secret"] = SHARED_SECRET })
	if not decoded then
		return { active = false }
	end
	return decoded
end

local function fetchVerificationStatus(player)
	local url = ("%s?robloxId=%s"):format(STATUS_URL, tostring(player.UserId))
	local decoded = httpGet(url, { ["x-elvira-secret"] = SHARED_SECRET })
	if not decoded then
		return { linked = false }
	end
	return decoded
end

-- ---------- Initial state: hub info + already-linked check, in one round trip ----------
getInitialState.OnServerEvent:Connect(function(player)
	local hubInfo = fetchHubInfo()
	local status = fetchVerificationStatus(player)

	getInitialStateResult:FireClient(player, {
		alreadyLinked = status.linked == true,
		discordUsername = status.discordUsername,
		hubActive = hubInfo.active == true,
		hubTitle = hubInfo.title,
		hubMessage = hubInfo.message,
		hubRequireAck = hubInfo.requireAck ~= false,
	})
end)

-- ---------- Polling used only while the hub screen has no "Understood" button ----------
checkHubStatus.OnServerEvent:Connect(function(player)
	local hubInfo = fetchHubInfo()
	checkHubStatusResult:FireClient(player, hubInfo.active == true)
end)

-- ---------- Redeem the 6-digit code ----------
verifyRemote.OnServerEvent:Connect(function(player, code)
	if typeof(code) ~= "string" or not code:match("^%d%d%d%d%d%d$") then
		verifyResult:FireClient(player, false, "Please enter a valid 6-digit code.")
		return
	end

	local body = HttpService:JSONEncode({
		code = code,
		robloxId = tostring(player.UserId),
		robloxUsername = player.Name,
	})

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = REDEEM_URL,
			Method = "POST",
			Headers = {
				["Content-Type"] = "application/json",
				["x-elvira-secret"] = SHARED_SECRET,
			},
			Body = body,
		})
	end)

	if not ok then
		verifyResult:FireClient(player, false, "Could not reach the verification server. Please try again in a moment.")
		return
	end

	local decodedOk, decoded = pcall(function()
		return HttpService:JSONDecode(response.Body)
	end)

	if not decodedOk or not decoded then
		verifyResult:FireClient(player, false, "Unexpected response from the server. Please try again.")
		return
	end

	verifyResult:FireClient(player, decoded.success == true, decoded.message or "Something went wrong.")
end)
