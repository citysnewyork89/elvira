-- =========================================================
-- ELVIRA TECHNOLOGIES — Account verification + Hub info (CLIENT)
-- Where to paste this: StarterGui > new LocalScript
-- (Studio: right-click StarterGui > Insert Object > LocalScript)
--
-- Pairs with ServerScriptService_VerificationServer.lua, which must be
-- pasted into ServerScriptService.
-- =========================================================

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ContentProvider = game:GetService("ContentProvider")
local TweenService = game:GetService("TweenService")
local StarterGui = game:GetService("StarterGui")
local SoundService = game:GetService("SoundService")

local player = Players.LocalPlayer

-- Disable the reset character button — this flow can't be restarted.
pcall(function()
	StarterGui:SetCore("ResetButtonCallback", false)
end)

-- ---------- Assets ----------
local ASSETS = {
	logoSplash = "rbxassetid://86577791097438", -- 60x61
	spinner = "rbxassetid://2243023654", -- 24x24
	logoDark = "rbxassetid://94921679047493", -- 60x61 (2d2d2d screens)
	successIcon = "rbxassetid://70602932215512", -- 352x357
	failIcon = "rbxassetid://140442856483832",
	musicId = "rbxassetid://9046863579",
}

task.spawn(function()
	local toPreload = {}
	for _, id in pairs(ASSETS) do
		if typeof(id) == "string" and id:match("^rbxassetid://") then
			table.insert(toPreload, id)
		end
	end
	pcall(function()
		ContentProvider:PreloadAsync(toPreload)
	end)
end)

-- ---------- Background music ----------
local music = Instance.new("Sound")
music.Name = "ElviraBackgroundMusic"
music.SoundId = ASSETS.musicId
music.Looped = true
music.Volume = 0.35
music.Parent = SoundService
music:Play()

-- ---------- Remotes ----------
local verifyRemote = ReplicatedStorage:WaitForChild("VerifyRobloxCode")
local verifyResult = ReplicatedStorage:WaitForChild("VerifyRobloxCodeResult")
local getInitialState = ReplicatedStorage:WaitForChild("GetInitialState")
local getInitialStateResult = ReplicatedStorage:WaitForChild("GetInitialStateResult")
local checkHubStatus = ReplicatedStorage:WaitForChild("CheckHubStatus")
local checkHubStatusResult = ReplicatedStorage:WaitForChild("CheckHubStatusResult")

-- ---------- Root ScreenGui ----------
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "ElviraVerificationUI"
screenGui.ResetOnSpawn = false
screenGui.IgnoreGuiInset = true
screenGui.DisplayOrder = 100
screenGui.Parent = player:WaitForChild("PlayerGui")

local function interFont(weight)
	return Font.fromName("Inter", weight or Enum.FontWeight.Regular)
end

-- ---------- Helpers ----------
local function newFullscreenFrame(name, bgColor)
	local f = Instance.new("Frame")
	f.Name = name
	f.AnchorPoint = Vector2.new(0.5, 0.5)
	f.Position = UDim2.fromScale(0.5, 0.5)
	f.Size = UDim2.fromScale(1, 1)
	f.BackgroundColor3 = bgColor
	f.BorderSizePixel = 0
	f.ZIndex = 10
	f.Visible = false
	f.Parent = screenGui
	return f
end

local function fadeIn(frame, duration)
	duration = duration or 0.45
	frame.Visible = true

	local scale = Instance.new("UIScale")
	scale.Scale = 0.96
	scale.Parent = frame

	local originalBg = frame.BackgroundTransparency
	frame.BackgroundTransparency = 1

	local fadables = {}
	for _, obj in ipairs(frame:GetDescendants()) do
		if obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox") then
			table.insert(fadables, { obj = obj, prop = "TextTransparency", original = obj.TextTransparency })
			obj.TextTransparency = 1
		end
		if obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
			table.insert(fadables, { obj = obj, prop = "ImageTransparency", original = obj.ImageTransparency })
			obj.ImageTransparency = 1
		end
	end

	local tweenInfo = TweenInfo.new(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	TweenService:Create(frame, tweenInfo, { BackgroundTransparency = originalBg }):Play()
	TweenService:Create(scale, tweenInfo, { Scale = 1 }):Play()
	for _, item in ipairs(fadables) do
		TweenService:Create(item.obj, tweenInfo, { [item.prop] = item.original }):Play()
	end
end

local function fadeOut(frame, duration, destroyAfter)
	duration = duration or 0.4
	local tweenInfo = TweenInfo.new(duration, Enum.EasingStyle.Quad, Enum.EasingDirection.In)

	for _, obj in ipairs(frame:GetDescendants()) do
		if obj:IsA("TextLabel") or obj:IsA("TextButton") or obj:IsA("TextBox") then
			TweenService:Create(obj, tweenInfo, { TextTransparency = 1 }):Play()
		end
		if obj:IsA("ImageLabel") or obj:IsA("ImageButton") then
			TweenService:Create(obj, tweenInfo, { ImageTransparency = 1 }):Play()
		end
	end

	local bgTween = TweenService:Create(frame, tweenInfo, { BackgroundTransparency = 1 })
	bgTween:Play()
	bgTween.Completed:Connect(function()
		frame.Visible = false
		if destroyAfter then
			frame:Destroy()
		end
	end)
end

local function spinForever(imageLabel)
	local tween = TweenService:Create(
		imageLabel,
		TweenInfo.new(0.9, Enum.EasingStyle.Linear, Enum.EasingDirection.InOut, -1, false),
		{ Rotation = 360 }
	)
	tween:Play()
	return tween
end

-- ================================================================
-- 1) SPLASH SCREEN (white)
-- ================================================================
local splash = newFullscreenFrame("Splash", Color3.fromRGB(255, 255, 255))

local splashLogo = Instance.new("ImageLabel")
splashLogo.BackgroundTransparency = 1
splashLogo.Image = ASSETS.logoSplash
splashLogo.AnchorPoint = Vector2.new(0.5, 0.5)
splashLogo.Position = UDim2.fromScale(0.5, 0.5)
splashLogo.Size = UDim2.fromOffset(60, 61)
splashLogo.Parent = splash

local splashSpinner = Instance.new("ImageLabel")
splashSpinner.BackgroundTransparency = 1
splashSpinner.Image = ASSETS.spinner
splashSpinner.AnchorPoint = Vector2.new(0.5, 1)
splashSpinner.Position = UDim2.new(0.5, 0, 1, -28)
splashSpinner.Size = UDim2.fromOffset(24, 24)
splashSpinner.Parent = splash

-- ================================================================
-- 2) HUB INFORMATION SCREEN (2d2d2d) — set from the dashboard
-- ================================================================
local hubScreen = newFullscreenFrame("HubInfo", Color3.fromRGB(45, 45, 45))

local hubContainer = Instance.new("Frame")
hubContainer.BackgroundTransparency = 1
hubContainer.AnchorPoint = Vector2.new(0.5, 0.5)
hubContainer.Position = UDim2.fromScale(0.5, 0.5)
hubContainer.Size = UDim2.new(1, 0, 0, 0)
hubContainer.AutomaticSize = Enum.AutomaticSize.Y
hubContainer.Parent = hubScreen

local hubPadding = Instance.new("UIPadding")
hubPadding.PaddingLeft = UDim.new(0.08, 0)
hubPadding.PaddingRight = UDim.new(0.08, 0)
hubPadding.Parent = hubContainer

local hubSizeConstraint = Instance.new("UISizeConstraint")
hubSizeConstraint.MaxSize = Vector2.new(640, math.huge)
hubSizeConstraint.Parent = hubContainer

local hubLayout = Instance.new("UIListLayout")
hubLayout.SortOrder = Enum.SortOrder.LayoutOrder
hubLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
hubLayout.Padding = UDim.new(0, 14)
hubLayout.Parent = hubContainer

local hubLogo = Instance.new("ImageLabel")
hubLogo.BackgroundTransparency = 1
hubLogo.Image = ASSETS.logoDark
hubLogo.Size = UDim2.fromOffset(60, 61)
hubLogo.LayoutOrder = 1
hubLogo.Parent = hubContainer

local hubTitle = Instance.new("TextLabel")
hubTitle.BackgroundTransparency = 1
hubTitle.Text = ""
hubTitle.FontFace = interFont(Enum.FontWeight.Bold)
hubTitle.TextSize = 48
hubTitle.TextColor3 = Color3.fromRGB(255, 255, 255)
hubTitle.TextXAlignment = Enum.TextXAlignment.Center
hubTitle.TextWrapped = true
hubTitle.Size = UDim2.new(1, 0, 0, 0)
hubTitle.AutomaticSize = Enum.AutomaticSize.Y
hubTitle.LayoutOrder = 2
hubTitle.Parent = hubContainer

local hubMessage = Instance.new("TextLabel")
hubMessage.BackgroundTransparency = 1
hubMessage.Text = ""
hubMessage.FontFace = interFont(Enum.FontWeight.Medium)
hubMessage.TextSize = 20
hubMessage.TextColor3 = Color3.fromRGB(255, 255, 255)
hubMessage.TextXAlignment = Enum.TextXAlignment.Center
hubMessage.TextWrapped = true
hubMessage.Size = UDim2.new(1, 0, 0, 0)
hubMessage.AutomaticSize = Enum.AutomaticSize.Y
hubMessage.LayoutOrder = 3
hubMessage.Parent = hubContainer

local hubAckButton = Instance.new("TextButton")
hubAckButton.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
hubAckButton.Text = "Understood"
hubAckButton.FontFace = interFont(Enum.FontWeight.Medium)
hubAckButton.TextSize = 20
hubAckButton.TextColor3 = Color3.fromRGB(255, 255, 255)
hubAckButton.Size = UDim2.fromOffset(220, 52)
hubAckButton.LayoutOrder = 4
hubAckButton.Visible = false
hubAckButton.Parent = hubContainer

local hubAckButtonCorner = Instance.new("UICorner")
hubAckButtonCorner.CornerRadius = UDim.new(0, 8)
hubAckButtonCorner.Parent = hubAckButton

-- ================================================================
-- 3) "LINK YOUR ROBLOX ACCOUNT" SCREEN (2d2d2d)
-- ================================================================
local linkScreen = newFullscreenFrame("LinkAccount", Color3.fromRGB(45, 45, 45))

local linkContainer = Instance.new("Frame")
linkContainer.BackgroundTransparency = 1
linkContainer.AnchorPoint = Vector2.new(0.5, 0.5)
linkContainer.Position = UDim2.fromScale(0.5, 0.5)
linkContainer.Size = UDim2.new(1, 0, 0, 0)
linkContainer.AutomaticSize = Enum.AutomaticSize.Y
linkContainer.Parent = linkScreen

local linkSizeConstraint = Instance.new("UISizeConstraint")
linkSizeConstraint.MaxSize = Vector2.new(720, math.huge)
linkSizeConstraint.Parent = linkContainer

local linkPadding = Instance.new("UIPadding")
linkPadding.PaddingLeft = UDim.new(0.08, 0)
linkPadding.PaddingRight = UDim.new(0.08, 0)
linkPadding.Parent = linkContainer

local linkLayout = Instance.new("UIListLayout")
linkLayout.SortOrder = Enum.SortOrder.LayoutOrder
linkLayout.Padding = UDim.new(0, 14)
linkLayout.Parent = linkContainer

local linkLogo = Instance.new("ImageLabel")
linkLogo.BackgroundTransparency = 1
linkLogo.Image = ASSETS.logoDark
linkLogo.Size = UDim2.fromOffset(60, 61)
linkLogo.LayoutOrder = 1
linkLogo.Parent = linkContainer

local linkTitle = Instance.new("TextLabel")
linkTitle.BackgroundTransparency = 1
linkTitle.Text = "Link your Roblox account"
linkTitle.FontFace = interFont(Enum.FontWeight.Bold)
linkTitle.TextSize = 48
linkTitle.TextColor3 = Color3.fromRGB(255, 255, 255)
linkTitle.TextXAlignment = Enum.TextXAlignment.Left
linkTitle.TextWrapped = true
linkTitle.Size = UDim2.new(1, 0, 0, 0)
linkTitle.AutomaticSize = Enum.AutomaticSize.Y
linkTitle.LayoutOrder = 2
linkTitle.Parent = linkContainer

local linkSubtitle = Instance.new("TextLabel")
linkSubtitle.BackgroundTransparency = 1
linkSubtitle.Text = "Enter the 6-digit PIN code that appears when you log in to the website. If you still don't know how to get it, you can follow these steps:"
linkSubtitle.FontFace = interFont(Enum.FontWeight.Medium)
linkSubtitle.TextSize = 20
linkSubtitle.TextColor3 = Color3.fromRGB(255, 255, 255)
linkSubtitle.TextXAlignment = Enum.TextXAlignment.Left
linkSubtitle.TextWrapped = true
linkSubtitle.Size = UDim2.new(1, 0, 0, 0)
linkSubtitle.AutomaticSize = Enum.AutomaticSize.Y
linkSubtitle.LayoutOrder = 3
linkSubtitle.Parent = linkContainer

local linkSteps = Instance.new("TextLabel")
linkSteps.BackgroundTransparency = 1
linkSteps.RichText = true
linkSteps.Text = table.concat({
	"<b>1.</b> Go to the website <b>elvira-sigma.vercel.app.</b>",
	"<b>2.</b> Click \"Log In\", then <b>copy the code</b> that is regenerated every 5 minutes.",
	"<b>3.</b> Come back here and <b>paste it, then click \"Verify\".</b> If everything is correct, the verification will be completed, and you can return to the website. Your account will have been successfully linked.",
}, "\n")
linkSteps.FontFace = interFont(Enum.FontWeight.Medium)
linkSteps.TextSize = 20
linkSteps.TextColor3 = Color3.fromRGB(255, 255, 255)
linkSteps.TextXAlignment = Enum.TextXAlignment.Left
linkSteps.TextWrapped = true
linkSteps.Size = UDim2.new(1, 0, 0, 0)
linkSteps.AutomaticSize = Enum.AutomaticSize.Y
linkSteps.LayoutOrder = 4
linkSteps.Parent = linkContainer

local inputRow = Instance.new("Frame")
inputRow.BackgroundTransparency = 1
inputRow.Size = UDim2.new(1, 0, 0, 56)
inputRow.LayoutOrder = 5
inputRow.Parent = linkContainer

local inputRowLayout = Instance.new("UIListLayout")
inputRowLayout.FillDirection = Enum.FillDirection.Horizontal
inputRowLayout.VerticalAlignment = Enum.VerticalAlignment.Center
inputRowLayout.Padding = UDim.new(0, 12)
inputRowLayout.Parent = inputRow

local codeBox = Instance.new("TextBox")
codeBox.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
codeBox.PlaceholderText = "Enter the code"
codeBox.PlaceholderColor3 = Color3.fromRGB(127, 127, 127)
codeBox.Text = ""
codeBox.FontFace = interFont(Enum.FontWeight.Medium)
codeBox.TextSize = 32 -- Roblox uses one TextSize for placeholder + typed text
codeBox.TextColor3 = Color3.fromRGB(0, 0, 0)
codeBox.ClearTextOnFocus = false
codeBox.Size = UDim2.new(0.68, 0, 1, 0)
codeBox.LayoutOrder = 1
codeBox.Parent = inputRow

local codeBoxCorner = Instance.new("UICorner")
codeBoxCorner.CornerRadius = UDim.new(1, 0)
codeBoxCorner.Parent = codeBox

local codeBoxStroke = Instance.new("UIStroke")
codeBoxStroke.Color = Color3.fromRGB(217, 217, 217)
codeBoxStroke.Thickness = 1
codeBoxStroke.Parent = codeBox

local codeBoxPadding = Instance.new("UIPadding")
codeBoxPadding.PaddingLeft = UDim.new(0, 20)
codeBoxPadding.PaddingRight = UDim.new(0, 20)
codeBoxPadding.Parent = codeBox

local verifyButton = Instance.new("TextButton")
verifyButton.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
verifyButton.Text = "Verify me"
verifyButton.FontFace = interFont(Enum.FontWeight.Medium)
verifyButton.TextSize = 20
verifyButton.TextColor3 = Color3.fromRGB(255, 255, 255)
verifyButton.Size = UDim2.new(0.32, 0, 1, 0)
verifyButton.LayoutOrder = 2
verifyButton.Parent = inputRow

local verifyButtonCorner = Instance.new("UICorner")
verifyButtonCorner.CornerRadius = UDim.new(1, 0)
verifyButtonCorner.Parent = verifyButton

local linkError = Instance.new("TextLabel")
linkError.BackgroundTransparency = 1
linkError.Text = ""
linkError.FontFace = interFont(Enum.FontWeight.Medium)
linkError.TextSize = 16
linkError.TextColor3 = Color3.fromRGB(255, 120, 120)
linkError.TextXAlignment = Enum.TextXAlignment.Left
linkError.TextWrapped = true
linkError.Size = UDim2.new(1, 0, 0, 0)
linkError.AutomaticSize = Enum.AutomaticSize.Y
linkError.LayoutOrder = 6
linkError.Visible = false
linkError.Parent = linkContainer

-- ================================================================
-- 4) "VERIFYING..." SCREEN (white, spinner)
-- ================================================================
local verifyingScreen = newFullscreenFrame("Verifying", Color3.fromRGB(255, 255, 255))

local verifyingSpinner = Instance.new("ImageLabel")
verifyingSpinner.BackgroundTransparency = 1
verifyingSpinner.Image = ASSETS.spinner
verifyingSpinner.AnchorPoint = Vector2.new(0.5, 0.5)
verifyingSpinner.Position = UDim2.fromScale(0.5, 0.5)
verifyingSpinner.Size = UDim2.fromOffset(24, 24)
verifyingSpinner.Parent = verifyingScreen

-- ================================================================
-- 5) RESULT SCREEN (success / fail / already verified) (2d2d2d)
-- ================================================================
local resultScreen = newFullscreenFrame("Result", Color3.fromRGB(45, 45, 45))

local resultContainer = Instance.new("Frame")
resultContainer.BackgroundTransparency = 1
resultContainer.AnchorPoint = Vector2.new(0.5, 0.5)
resultContainer.Position = UDim2.fromScale(0.5, 0.5)
resultContainer.Size = UDim2.new(1, 0, 0, 0)
resultContainer.AutomaticSize = Enum.AutomaticSize.Y
resultContainer.Parent = resultScreen

local resultPadding = Instance.new("UIPadding")
resultPadding.PaddingLeft = UDim.new(0.08, 0)
resultPadding.PaddingRight = UDim.new(0.08, 0)
resultPadding.Parent = resultContainer

local resultSizeConstraint = Instance.new("UISizeConstraint")
resultSizeConstraint.MaxSize = Vector2.new(640, math.huge)
resultSizeConstraint.Parent = resultContainer

local resultLayout = Instance.new("UIListLayout")
resultLayout.SortOrder = Enum.SortOrder.LayoutOrder
resultLayout.HorizontalAlignment = Enum.HorizontalAlignment.Center
resultLayout.Padding = UDim.new(0, 14)
resultLayout.Parent = resultContainer

local resultLogo = Instance.new("ImageLabel")
resultLogo.BackgroundTransparency = 1
resultLogo.Image = ASSETS.logoDark
resultLogo.Size = UDim2.fromOffset(60, 61)
resultLogo.LayoutOrder = 1
resultLogo.Parent = resultContainer

local resultTitle = Instance.new("TextLabel")
resultTitle.BackgroundTransparency = 1
resultTitle.Text = ""
resultTitle.FontFace = interFont(Enum.FontWeight.Bold)
resultTitle.TextSize = 48
resultTitle.TextColor3 = Color3.fromRGB(255, 255, 255)
resultTitle.TextXAlignment = Enum.TextXAlignment.Center
resultTitle.TextWrapped = true
resultTitle.Size = UDim2.new(1, 0, 0, 0)
resultTitle.AutomaticSize = Enum.AutomaticSize.Y
resultTitle.LayoutOrder = 2
resultTitle.Parent = resultContainer

local resultSubtitle = Instance.new("TextLabel")
resultSubtitle.BackgroundTransparency = 1
resultSubtitle.Text = ""
resultSubtitle.FontFace = interFont(Enum.FontWeight.Medium)
resultSubtitle.TextSize = 20
resultSubtitle.TextColor3 = Color3.fromRGB(255, 255, 255)
resultSubtitle.TextXAlignment = Enum.TextXAlignment.Center
resultSubtitle.TextWrapped = true
resultSubtitle.Size = UDim2.new(1, 0, 0, 0)
resultSubtitle.AutomaticSize = Enum.AutomaticSize.Y
resultSubtitle.LayoutOrder = 3
resultSubtitle.Parent = resultContainer

local resultImage = Instance.new("ImageLabel")
resultImage.BackgroundTransparency = 1
resultImage.Image = ""
resultImage.Size = UDim2.fromOffset(176, 178.5) -- 352x357 scaled down
resultImage.LayoutOrder = 4
resultImage.Visible = false
resultImage.Parent = resultContainer

local retryButton = Instance.new("TextButton")
retryButton.BackgroundColor3 = Color3.fromRGB(0, 0, 0)
retryButton.Text = "Try Again"
retryButton.FontFace = interFont(Enum.FontWeight.Medium)
retryButton.TextSize = 20
retryButton.TextColor3 = Color3.fromRGB(255, 255, 255)
retryButton.Size = UDim2.fromOffset(220, 52)
retryButton.LayoutOrder = 5
retryButton.Visible = false
retryButton.Parent = resultContainer

local retryButtonCorner = Instance.new("UICorner")
retryButtonCorner.CornerRadius = UDim.new(1, 0)
retryButtonCorner.Parent = retryButton

-- ================================================================
-- State machine
-- ================================================================

local function showLinkScreen()
	linkError.Visible = false
	linkError.Text = ""
	codeBox.Text = ""
	verifyButton.Text = "Verify me"
	verifyButton.Active = true
	fadeIn(linkScreen)
end

local function showVerifyingScreen()
	fadeOut(linkScreen, 0.3)
	verifyingScreen.Visible = true
	spinForever(verifyingSpinner)
	task.delay(0.15, function()
		fadeIn(verifyingScreen, 0.3)
	end)
end

local function showResult(kind, title, subtitle, imageId)
	fadeOut(verifyingScreen, 0.3, false)

	resultTitle.Text = title
	resultSubtitle.Text = subtitle

	if imageId then
		resultImage.Image = imageId
		resultImage.Visible = true
	else
		resultImage.Visible = false
	end

	retryButton.Visible = (kind == "fail")

	task.delay(0.2, function()
		fadeIn(resultScreen, 0.5)
	end)
end

local function showSuccess()
	showResult(
		"success",
		"Verification successful!",
		"Our system has successfully linked your Roblox account to our systems. You can now browse and shop on Elvira.",
		ASSETS.successIcon
	)
end

local function showFailure(message)
	showResult(
		"fail",
		"Verification failed",
		message or "We're sorry, but we couldn't complete your verification due to an error. Your code may have expired or may be incorrect. Please try again with a new code. If the issue persists, contact an agent at https://discord.gg/4bZDmEagpH.",
		ASSETS.failIcon
	)
end

local function showAlreadyVerified(discordUsername)
	showResult(
		"already",
		"You are already verified",
		("This Roblox account is already linked to a Discord account, which is @%s. Please unlink your account or link a new account. If you need help, you can contact us through Discord or our website."):format(
			discordUsername or "unknown"
		),
		nil
	)
end

-- Called once we know whether to show the code screen or the already-linked one.
local function proceedPastHub(state)
	if state.alreadyLinked then
		showAlreadyVerified(state.discordUsername)
	else
		showLinkScreen()
	end
end

-- Poll every 5s while the hub screen has no "Understood" button, so it
-- disappears automatically as soon as it's turned off from the dashboard.
local function pollHubUntilInactive(state)
	task.spawn(function()
		while hubScreen.Visible do
			task.wait(5)
			if not hubScreen.Visible then
				return
			end
			local ok, stillActive = pcall(function()
				local result
				local conn
				conn = checkHubStatusResult.OnClientEvent:Connect(function(active)
					result = active
				end)
				checkHubStatus:FireServer()
				local waited = 0
				while result == nil and waited < 8 do
					task.wait(0.25)
					waited += 0.25
				end
				conn:Disconnect()
				return result
			end)

			if ok and stillActive == false then
				fadeOut(hubScreen, 0.5, true)
				task.delay(0.3, function()
					proceedPastHub(state)
				end)
				return
			end
		end
	end)
end

local function showHubScreen(state)
	hubTitle.Text = state.hubTitle or ""
	hubMessage.Text = state.hubMessage or ""
	hubAckButton.Visible = state.hubRequireAck == true

	fadeIn(hubScreen)

	if state.hubRequireAck then
		hubAckButton.MouseButton1Click:Connect(function()
			fadeOut(hubScreen, 0.4, true)
			task.delay(0.25, function()
				proceedPastHub(state)
			end)
		end)
	else
		pollHubUntilInactive(state)
	end
end

verifyButton.MouseButton1Click:Connect(function()
	local code = codeBox.Text:gsub("%D", "")

	if #code ~= 6 then
		linkError.Text = "Please enter the 6-digit code exactly as shown on the website."
		linkError.Visible = true
		return
	end

	linkError.Visible = false
	verifyButton.Active = false
	showVerifyingScreen()
	verifyRemote:FireServer(code)
end)

verifyResult.OnClientEvent:Connect(function(success, message)
	if success then
		showSuccess()
	else
		showFailure(message)
	end
end)

retryButton.MouseButton1Click:Connect(function()
	fadeOut(resultScreen, 0.3)
	task.delay(0.2, function()
		showLinkScreen()
	end)
end)

-- ================================================================
-- Startup
-- ================================================================
local splashStart = tick()
splash.Visible = true
splash.BackgroundTransparency = 0
splashLogo.ImageTransparency = 0
spinForever(splashSpinner)

getInitialState:FireServer()

getInitialStateResult.OnClientEvent:Connect(function(state)
	local elapsed = tick() - splashStart
	local remaining = math.max(0, 4 - elapsed)

	task.delay(remaining, function()
		fadeOut(splash, 0.5, true)
		task.delay(0.3, function()
			if state.hubActive then
				showHubScreen(state)
			else
				proceedPastHub(state)
			end
		end)
	end)
end)
