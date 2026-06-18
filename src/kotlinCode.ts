import { AndroidCodeFile } from './types';

export const kotlinCodebase: AndroidCodeFile[] = [
  {
    name: "MainActivity.kt",
    path: "app/src/main/java/com/autopilot/boatcontroller/MainActivity.kt",
    language: "kotlin",
    description: "The primary Single-Activity entry point of the app, built using Jetpack Compose. It checks for permissions, manages the UI state, binds the Sensor Compass & GPS services, and handles navigation recording and playing.",
    code: `package com.autopilot.boatcontroller

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.autopilot.boatcontroller.helpers.*
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {

    private lateinit var sensorHelper: AutopilotSensorHelper
    private lateinit var locationHelper: AutopilotLocationHelper
    private lateinit var udpClient: CoroutineUdpClient
    private lateinit var pathStorageHelper: PathStorageHelper

    // Reacting states for Compose UI
    private var currentLatitude by mutableStateOf(0.0)
    private var currentLongitude by mutableStateOf(0.0)
    private var compassHeading by mutableStateOf(0f)
    private var isRecording by mutableStateOf(false)
    private var isPlaying by mutableStateOf(false)
    private var targetIp by mutableStateOf("192.168.4.1")
    private var targetPort by mutableStateOf(8266)
    
    // Autopilot calculated states
    private var targetBearing by mutableStateOf(0f)
    private var distanceToWaypoint by mutableStateOf(0f)
    private var currentWaypointIndex by mutableStateOf(-1)
    private var totalWaypointsCount by mutableStateOf(0)
    private var headingError by mutableStateOf(0f)
    
    // Safety & Networking Diagnostics
    private var watchdogStatus by mutableStateOf("NOT STARTED")
    private var watchdogStateColor by mutableStateOf(Color(0xFF9E9E9E)) // Gray
    private var lastLocationTimeMs by mutableStateOf(0L)
    private var packetsSent by mutableStateOf(0)

    // Active path variables
    private val recordedPath = mutableStateListOf<PathStorageHelper.Waypoint>()
    private var navigationJob: Job? = null
    private var watchdogJob: Job? = null

    // Permission launcher
    private val requestPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        val fineGranted = permissions[Manifest.permission.ACCESS_FINE_LOCATION] ?: false
        val coarseGranted = permissions[Manifest.permission.ACCESS_COARSE_LOCATION] ?: false
        val sensorGranted = permissions[Manifest.permission.HIGH_SAMPLING_RATE_SENSORS] ?: true // fallback
        
        if (fineGranted || coarseGranted) {
            setupLocationUpdates()
            startWatchdogTimer()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Initialize helper components
        sensorHelper = AutopilotSensorHelper(this) { azimuth ->
            compassHeading = azimuth
            recalculateAutopilot()
        }
        
        locationHelper = AutopilotLocationHelper(this) { location ->
            currentLatitude = location.latitude
            currentLongitude = location.longitude
            lastLocationTimeMs = System.currentTimeMillis()
            
            if (isRecording) {
                pathStorageHelper.addWaypoint(location.latitude, location.longitude)
                loadRecordedPathList()
            }
            
            recalculateAutopilot()
        }

        udpClient = CoroutineUdpClient(lifecycleScope)
        pathStorageHelper = PathStorageHelper(this)
        
        loadRecordedPathList()
        checkAndRequestPermissions()

        setContent {
            MaterialTheme(
                colorScheme = darkColorScheme(
                    primary = Color(0xFF0D9488), // Teal 600
                    background = Color(0xFF0F172A), // Slate 900
                    surface = Color(0xFF1E293B) // Slate 800
                )
            ) {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    AutopilotDashboardUI()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        sensorHelper.register()
    }

    override fun onPause() {
        super.onPause()
        sensorHelper.unregister()
    }

    private fun checkAndRequestPermissions() {
        val permissions = mutableListOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        )
        
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            permissions.add(Manifest.permission.HIGH_SAMPLING_RATE_SENSORS)
        }
        
        // Background permission (needs separate flow on modern Android APIs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Note: Best practice on Q+ is asking in-app since immediate BG triggers play reject,
            // but we register it here for direct evaluation.
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                permissions.add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
        }

        val allGranted = permissions.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

        if (allGranted) {
            setupLocationUpdates()
            startWatchdogTimer()
        } else {
            requestPermissionLauncher.launch(permissions.toTypedArray())
        }
    }

    private fun setupLocationUpdates() {
        try {
            locationHelper.startLocationUpdates()
        } catch (e: SecurityException) {
            watchdogStatus = "ERROR: PERMISSION DENIED"
            watchdogStateColor = Color(0xFFEF4444)
        }
    }

    private fun loadRecordedPathList() {
        recordedPath.clear()
        recordedPath.addAll(pathStorageHelper.getPath())
        totalWaypointsCount = recordedPath.size
    }

    private fun startWatchdogTimer() {
        watchdogJob?.cancel()
        watchdogJob = lifecycleScope.launch {
            while (true) {
                delay(1000) // Trigger audit every second
                val now = System.currentTimeMillis()
                val elapsedSinceLastLocation = now - lastLocationTimeMs
                
                if (lastLocationTimeMs == 0L) {
                    watchdogStatus = "WAITING FOR INITIAL GPS"
                    watchdogStateColor = Color(0xFFFBBF24) // Yellow
                } else if (elapsedSinceLastLocation > 1000) {
                    // Update rate under 1Hz (more than 1000ms delay)
                    watchdogStatus = "SAFETY HALT: GPS rate < 1Hz (\${elapsedSinceLastLocation}ms)"
                    watchdogStateColor = Color(0xFFEF4444) // Red
                    
                    // Stop sending networking packets for safety
                    udpClient.setBlockNetworkPackets(true)
                } else {
                    watchdogStatus = "WATCHDOG ACTIVE (GPS Rate OK)"
                    watchdogStateColor = Color(0xFF10B981) // Emerald Green
                    udpClient.setBlockNetworkPackets(false)
                }
            }
        }
    }

    private fun recalculateAutopilot() {
        if (!isPlaying || currentWaypointIndex < 0 || currentWaypointIndex >= recordedPath.size) {
            return
        }

        val target = recordedPath[currentWaypointIndex]
        
        // Perform Bearing and Distance Calculations using actual Location formulas
        val results = FloatArray(2)
        android.location.Location.distanceBetween(
            currentLatitude, currentLongitude,
            target.latitude, target.longitude,
            results
        )
        
        distanceToWaypoint = results[0]  // Distance in meters
        targetBearing = results[1]       // Bearing in degrees (-180 to 180)

        // Standardize compass heading (-180 to 180) to sync with calculation
        val localCompass = if (compassHeading > 180) compassHeading - 360 else compassHeading
        headingError = targetBearing - localCompass
        
        // Wrap error between -180 and 180
        if (headingError > 180) headingError -= 360
        if (headingError < -180) headingError += 360

        // If very close to waypoint (e.g. within 5 meters), skip to next waypoint
        if (distanceToWaypoint < 5f) {
            if (currentWaypointIndex + 1 < recordedPath.size) {
                currentWaypointIndex++
            } else {
                // Course completed!
                isPlaying = false
                currentWaypointIndex = -1
                navigationJob?.cancel()
            }
        }
    }

    private fun startAutopilotTransmissionLoop() {
        navigationJob?.cancel()
        navigationJob = lifecycleScope.launch {
            while (isPlaying) {
                if (currentWaypointIndex != -1 && currentWaypointIndex < recordedPath.size) {
                    // Packet structure: HEADING_ERROR:[value],DIST:[value]
                    val payload = String.format("HEADING_ERROR:%.2f,DIST:%.1f", headingError, distanceToWaypoint)
                    
                    val sent = udpClient.sendUdpPacket(targetIp, targetPort, payload)
                    if (sent) {
                        packetsSent++
                    }
                }
                delay(200) // Transmit control frequency: 5Hz (every 200ms)
            }
        }
    }

    @OptIn(ExperimentalMaterial3Api::class)
    @Composable
    fun AutopilotDashboardUI() {
        val scrollState = rememberScrollState()
        
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            "AUTO-NAV BOAT CONTROLLER",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            fontSize = 18.sp
                        )
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = Color(0xFF0F172A)
                    )
                )
            }
        ) { paddingValues ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
                    .padding(16.dp)
                    .verticalScroll(scrollState),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // WATCHDOG ALARM DISPLAY
                Card(
                    colors = CardDefaults.cardColors(containerColor = watchdogStateColor),
                    shape = RoundedCornerShape(8.dp)
                ) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(12.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            text = "SECURITY STATUS: \${watchdogStatus.uppercase()}",
                            color = Color.White,
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                            modifier = Modifier.fillMaxWidth()
                        )
                    }
                }

                // GPS & SENSOR FEED
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Text("TELEMETRY AND SENSORS", fontWeight = FontWeight.Bold, color = Color(0xFF0D9488), fontSize = 13.sp)
                        
                        Divider(color = Color(0xFF334155))
                        
                        TelemetryRow("Boat Coordinates", String.format("%.6f, %.6f", currentLatitude, currentLongitude))
                        TelemetryRow("Compass Heading", String.format("%.1f° (Azimuth)", compassHeading))
                        TelemetryRow("Last Nav Update", if (lastLocationTimeMs > 0) "\${(System.currentTimeMillis() - lastLocationTimeMs) / 1000}s ago" else "No Fix")
                    }
                }

                // CONFIGURABLE COMM PANEL (ESP8266 IP / PORT)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("ESP8266 ACTUATOR CONFIG", fontWeight = FontWeight.Bold, color = Color(0xFF0D9488), fontSize = 13.sp)
                        Divider(color = Color(0xFF334155))
                        
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedTextField(
                                value = targetIp,
                                onValueChange = { targetIp = it },
                                label = { Text("IP Address", fontSize = 11.sp) },
                                modifier = Modifier.weight(1.5f),
                                singleLine = true,
                                shape = RoundedCornerShape(8.dp)
                            )
                            
                            OutlinedTextField(
                                value = targetPort.toString(),
                                onValueChange = { targetPort = it.toIntOrNull() ?: 8266 },
                                label = { Text("UDP Port", fontSize = 11.sp) },
                                modifier = Modifier.weight(1f),
                                singleLine = true,
                                shape = RoundedCornerShape(8.dp)
                            )
                        }
                        
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text("Sent UDP Packets:", fontSize = 12.sp, color = Color.Gray)
                            Text("\$packetsSent packets", fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                        }
                    }
                }

                // WAYPOINTS CONTROL STATION (RECORD AND PLAY)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text("PILOT WAYPOINTS SYSTEM", fontWeight = FontWeight.Bold, color = Color(0xFF0D9488), fontSize = 13.sp)
                        Divider(color = Color(0xFF334155))

                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(12.dp)
                        ) {
                            Button(
                                onClick = {
                                    if (isRecording) {
                                        isRecording = false
                                    } else {
                                        pathStorageHelper.clearPath()
                                        loadRecordedPathList()
                                        isRecording = true
                                        isPlaying = false
                                        currentWaypointIndex = -1
                                        navigationJob?.cancel()
                                    }
                                },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isRecording) Color(0xFFEF4444) else Color(0xFF0F766E)
                                ),
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text(if (isRecording) "🔴 STOP RECORD" else "📂 RECORD PATH")
                            }

                            Button(
                                onClick = {
                                    if (isPlaying) {
                                        isPlaying = false
                                        currentWaypointIndex = -1
                                        navigationJob?.cancel()
                                    } else {
                                        if (recordedPath.isNotEmpty()) {
                                            isRecording = false
                                            currentWaypointIndex = 0
                                            isPlaying = true
                                            startAutopilotTransmissionLoop()
                                        }
                                    }
                                },
                                enabled = recordedPath.isNotEmpty() || isPlaying,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = if (isPlaying) Color(0xFFD97706) else Color(0xFF0D9488)
                                ),
                                modifier = Modifier.weight(1f),
                                shape = RoundedCornerShape(8.dp)
                            ) {
                                Text(if (isPlaying) "⏸ HALT PLAY" else "⚡ PLAY PATH")
                            }
                        }

                        // NAVIGATION COMPASS CALCULATIONS
                        if (isPlaying && currentWaypointIndex != -1 && currentWaypointIndex < recordedPath.size) {
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .background(Color(0xFF1E293B))
                                    .border(1.dp, Color(0xFF334155), RoundedCornerShape(6.dp))
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Waypoint Track:", fontSize = 12.sp, color = Color.Gray)
                                    Text("\${currentWaypointIndex + 1} of \$totalWaypointsCount", fontWeight = FontWeight.Bold)
                                }
                                
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Target Bearing (GPS):", fontSize = 12.sp, color = Color.Gray)
                                    Text(String.format("%.1f°", targetBearing), fontWeight = FontWeight.Bold, color = Color(0xFF2DD4BF))
                                }
                                
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Heading Error:", fontSize = 12.sp, color = Color.Gray)
                                    val errColor = if (Math.abs(headingError) < 10) Color(0xFF10B981) else Color(0xFFEF4444)
                                    Text(String.format("%.1f°", headingError), fontWeight = FontWeight.Bold, color = errColor)
                                }
                                
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Text("Distance Remaining:", fontSize = 12.sp, color = Color.Gray)
                                    Text(String.format("%.1f meters", distanceToWaypoint), fontWeight = FontWeight.Bold, color = Color(0xFF38BDF8))
                                }
                            }
                        } else {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(8.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = if (isRecording) "Currently recording coordinates... (\$totalWaypointsCount recorded)"
                                    else "Autopilot inactive. List contains \$totalWaypointsCount waypoints.",
                                    fontSize = 11.sp,
                                    color = Color.LightGray
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    @Composable
    fun TelemetryRow(label: String, value: String) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(label, color = Color.LightGray, fontSize = 12.sp)
            Text(value, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace, fontSize = 13.sp)
        }
    }
}
`
  },
  {
    name: "AutopilotSensorHelper.kt",
    path: "app/src/main/java/com/autopilot/boatcontroller/helpers/AutopilotSensorHelper.kt",
    language: "kotlin",
    description: "Implements hardware-level Sensor Fusion on Android. It registers the Rotation Vector sensor, retrieves the 4D unit quaternion, transforms it into a stable orientation matrix (to counteract vessel rolling and pitch), and extracts the yaw azimuth as a reliable compass relative to magnetic North.",
    code: `package com.autopilot.boatcontroller.helpers

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager

class AutopilotSensorHelper(
    context: Context,
    private val onHeadingUpdated: (azimuth: Float) -> Unit
) : SensorEventListener {

    private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    private val rotationVectorSensor: Sensor? = sensorManager.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)

    private val rotationMatrix = FloatArray(9)
    private val orientationValues = FloatArray(3)

    fun register() {
        rotationVectorSensor?.let {
            // Register with SENSOR_DELAY_GAME (~20ms latency) for continuous real-time orientation tracking
            sensorManager.registerListener(this, it, SensorManager.SENSOR_DELAY_GAME)
        }
    }

    fun unregister() {
        sensorManager.unregisterListener(this)
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event == null || event.sensor.type != Sensor.TYPE_ROTATION_VECTOR) return

        // Compute rotation matrix from Rotation Vector (sensor fusion outputs)
        SensorManager.getRotationMatrixFromVector(rotationMatrix, event.values)
        
        // Extract the orientation (yaw, pitch, roll) from rotation matrix
        SensorManager.getOrientation(rotationMatrix, orientationValues)

        // Convert the azimuth values from radians to degrees (-180 to 180)
        var azimuthDegrees = Math.toDegrees(orientationValues[0].toDouble()).toFloat()
        
        // Normalize degrees to typical compass range (0° - 360°)
        // 0 = North, 90 = East, 180 = South, 270 = West
        if (azimuthDegrees < 0) {
            azimuthDegrees += 360f
        }

        onHeadingUpdated(azimuthDegrees)
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Handle accuracy recalibrations in background if necessary
    }
}
`
  },
  {
    name: "AutopilotLocationHelper.kt",
    path: "app/src/main/java/com/autopilot/boatcontroller/helpers/AutopilotLocationHelper.kt",
    language: "kotlin",
    description: "Acts as the GPS provider. Interacts with Android LocationManager via granular criteria to requests GPS provider updates, providing the Lat/Lng feeds used to evaluate path records and target waypoint calculations.",
    code: `package com.autopilot.boatcontroller.helpers

import android.annotation.SuppressLint
import android.content.Context
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Bundle

class AutopilotLocationHelper(
    private val context: Context,
    private val onLocationChangedCallback: (Location) -> Unit
) : LocationListener {

    private val locationManager = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager

    @SuppressLint("MissingPermission")
    fun startLocationUpdates() {
        // Enforce high-precision updates to guarantee reliable boat bearing operations
        val isGpsEnabled = locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)
        
        if (isGpsEnabled) {
            // Request minimal updates as fast as possible to feed the 1Hz watchdog checks elegantly
            locationManager.requestLocationUpdates(
                LocationManager.GPS_PROVIDER,
                500L, // 500 ms minimum interval (updates up to 2Hz)
                0.2f, // 0.2 meters minimum distance change
                this
            )
        } else {
            // Fallback back to network provider if indoor or GPS has cold start-up delay
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER,
                    500L,
                    0.2f,
                    this
                )
            }
        }
    }

    fun stopLocationUpdates() {
        locationManager.removeUpdates(this)
    }

    override fun onLocationChanged(location: Location) {
        onLocationChangedCallback(location)
    }

    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
}
`
  },
  {
    name: "CoroutineUdpClient.kt",
    path: "app/src/main/java/com/autopilot/boatcontroller/helpers/CoroutineUdpClient.kt",
    language: "kotlin",
    description: "An asynchronous UDP messaging engine. Utilizing Kotlin coroutines & Dispatchers.IO, it binds network sockets without blocking the Compose render thread, and enforces safety bounds by discarding outgoing packets when flags are set by the watchdog manager.",
    code: `package com.autopilot.boatcontroller.helpers

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.util.concurrent.atomic.AtomicBoolean

class CoroutineUdpClient(private val scope: CoroutineScope) {

    // Thread-safe safety flag managed directly by the MainActivity location watchdog
    private val isBlockedByWatchdog = AtomicBoolean(false)

    fun setBlockNetworkPackets(block: Boolean) {
        isBlockedByWatchdog.set(block)
    }

    /**
     * Sends a UDP string payload to the target IP and Port without blocking the main UI thread.
     * Returns true if packet was sent successfully, false if blocked by safety watchdog or error occurred.
     */
    suspend fun sendUdpPacket(ipAddress: String, port: Int, message: String): Boolean {
        // Safety lock check: Fail immediately if watchdog flags a network lockout (GPS interval is lazy/dropping)
        if (isBlockedByWatchdog.get()) {
            return false
        }

        return withContext(Dispatchers.IO) {
            var socket: DatagramSocket? = null
            try {
                val address = InetAddress.getByName(ipAddress)
                val buffer = message.toByteArray()
                val packet = DatagramPacket(buffer, buffer.size, address, port)
                
                socket = DatagramSocket()
                socket.send(packet)
                true
            } catch (e: Exception) {
                e.printStackTrace()
                false
            } finally {
                socket?.close()
            }
        }
    }
}
`
  },
  {
    name: "PathStorageHelper.kt",
    path: "app/src/main/java/com/autopilot/boatcontroller/helpers/PathStorageHelper.kt",
    language: "kotlin",
    description: "Saves and loads latitude/longitude coordinate waypoint structures to dynamic JSON file configurations inside standard Android internal directories, completely bypassing external scope permission requirements.",
    code: `package com.autopilot.boatcontroller.helpers

import android.content.Context
import java.io.File

class PathStorageHelper(private val context: Context) {

    private val fileName = "recorded_autopilot_path.json"
    private val file: File get() = File(context.filesDir, fileName)

    data class Waypoint(
        val latitude: Double,
        val longitude: Double,
        val timestamp: Long
    )

    /**
     * Adds a coordinate to current storage
     */
    fun addWaypoint(latitude: Double, longitude: Double) {
        val currentPath = getPath().toMutableList()
        currentPath.add(Waypoint(latitude, longitude, System.currentTimeMillis()))
        savePath(currentPath)
    }

    /**
     * Saves list of waypoints as JSON string
     */
    fun savePath(waypoints: List<Waypoint>) {
        try {
            val jsonBuilder = StringBuilder()
            jsonBuilder.append("[")
            waypoints.forEachIndexed { index, wp ->
                jsonBuilder.append(
                    String.format(
                        "{\\"latitude\\":%f,\\"longitude\\":%f,\\"timestamp\\":%d}",
                        wp.latitude, wp.longitude, wp.timestamp
                    )
                )
                if (index < waypoints.size - 1) {
                    jsonBuilder.append(",")
                }
            }
            jsonBuilder.append("]")
            
            file.writeText(jsonBuilder.toString())
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    /**
     * Parses simple local JSON path file and returns waypoints array list
     */
    fun getPath(): List<Waypoint> {
        if (!file.exists()) return emptyList()

        return try {
            val content = file.readText()
            val list = mutableListOf<Waypoint>()
            
            // Basic custom parsing regex to avoid adding massive heavy libraries like Gson (for standalone flexibility)
            val regex = "\\\\{\\"latitude\\\\":([-+0-9.]+),\\\\"longitude\\\\":([-+0-9.]+),\\\\"timestamp\\\\":([0-9]+)\\\\}".toRegex()
            val matches = regex.findAll(content)
            
            for (match in matches) {
                val lat = match.groupValues[1].toDoubleOrNull() ?: 0.0
                val lng = match.groupValues[2].toDoubleOrNull() ?: 0.0
                val ts = match.groupValues[3].toLongOrNull() ?: 0L
                list.add(Waypoint(lat, lng, ts))
            }
            list
        } catch (e: Exception) {
            e.printStackTrace()
            emptyList()
        }
    }

    /**
     * Clears current path coordinates
     */
    fun clearPath() {
        if (file.exists()) {
            file.delete()
        }
    }
}
`
  },
  {
    name: "AndroidManifest.xml",
    path: "app/src/main/AndroidManifest.xml",
    language: "xml",
    description: "Defines Android hardware requirement policies: Coarse/Fine precise GPS coordinate extraction, Background GPS operations mapping for the standby watchdog routines, internet access rights for local ESP8266 UDP interactions.",
    code: `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.autopilot.boatcontroller">

    <!-- Precise GPS/Location access permission requirements -->
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    
    <!-- Required for background operations if the device screen is off -->
    <uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />

    <!-- Network permissions for ESP8266 WiFi communication -->
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />

    <!-- High-rate sensor telemetry access for rotation-vector orientation matrix -->
    <uses-permission android:name="android.permission.HIGH_SAMPLING_RATE_SENSORS" />

    <application
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:supportsRtl="true"
        android:theme="@style/Theme.AppCompat.NoActionBar">
        
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:theme="@style/Theme.AppCompat.NoActionBar">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
`
  },
  {
    name: "build.gradle.kts",
    path: "app/build.gradle.kts",
    language: "kotlin",
    description: "App-level configuration file setting up the dependency management for Jetpack Compose, state flow components, location providers, and packaging guidelines for Kotlin 2.x compile trees.",
    code: `plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.autopilot.boatcontroller"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.autopilot.boatcontroller"
        minSdk = 26
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
    }
    composeOptions {
        kotlinCompilerExtensionVersion = "1.5.1"
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

dependencies {
    // Jetpack Compose libraries
    implementation("androidx.activity:activity-compose:1.8.2")
    implementation(platform("androidx.compose:compose-bom:2023.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")

    // Coroutines for UDP network execution
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Lifecycles and core frameworks
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
    implementation("androidx.core:core-ktx:1.12.0")
}
`
  },
  {
    name: "esp8266_autopilot.ino",
    path: "firmware/esp8266_autopilot.ino",
    language: "cpp",
    description: "Arduino C++ sketch for ESP8266 Wi-Fi microcontroller. It provisions a standalone Local Access Point (AP), binds UDP interface, parses live steering commands, and modulates physical rudder actuator servo to guide the physical vessel to its targets.",
    code: `#include <ESP8266WiFi.h>
#include <WiFiUdp.h>
#include <Servo.h>

// Wi-Fi Access Point Credentials
const char* ap_ssid = "NavCore-Autopilot-AP";
const char* ap_password = "autopilot_secure_123";

// UDP Port
const unsigned int localUdpPort = 4210; 
char packetBuffer[255]; // buffer to hold incoming packet

WiFiUDP Udp;
Servo rudderServo;

// Hardware Pins
const int SERVO_PIN = 2;       // GPIO2 (D4 on NodeMCU) for rudder servo signal
const int STATUS_LED_PIN = 16;  // GPIO16 (D0 on NodeMCU) for status indication

// Safety Parameters
unsigned long lastPacketTime = 0;
const unsigned long WATCHDOG_TIMEOUT_MS = 2000; // Return rudder to center if signal is lost for 2 seconds

// Servo Actuator Calibrations
const int RUDDER_CENTER_ANGLE = 90; // Neutral straight heading
const int RUDDER_MAX_LEFT = 45;    // Maximum left steering angle
const int RUDDER_MAX_RIGHT = 135;  // Maximum right steering angle
const float STEERING_GAIN = 0.8;    // Proportional dampening multiplier for rudder sensitivity

void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println("\\n--- NAVCORE ESP8266 ACTUATOR START ---");

  // Configure Status LED and Servo
  pinMode(STATUS_LED_PIN, OUTPUT);
  digitalWrite(STATUS_LED_PIN, LOW); // Turn on LED to indicate boot sequence
  
  rudderServo.attach(SERVO_PIN);
  rudderServo.write(RUDDER_CENTER_ANGLE); // Center rudder on boot

  // Configure ESP8266 as an Access Point (AP Mode)
  Serial.print("Setting up Soft-AP... ");
  WiFi.softAP(ap_ssid, ap_password);
  
  IPAddress myIP = WiFi.softAPIP();
  Serial.print("AP Created! IP Address: ");
  Serial.println(myIP);

  // Start UDP Listener
  Udp.begin(localUdpPort);
  Serial.print("UDP Server listening on Port: ");
  Serial.println(localUdpPort);
  
  digitalWrite(STATUS_LED_PIN, HIGH); // Turn off LED (active high) to indicate ready
  lastPacketTime = millis();
}

void loop() {
  int packetSize = Udp.parsePacket();
  
  if (packetSize) {
    // Read packet into buffer
    int len = Udp.read(packetBuffer, 255);
    if (len > 0) {
      packetBuffer[len] = '\\0';
    }

    Serial.print("RECV Datagram: ");
    Serial.println(packetBuffer);

    // Heartbeat LED flash
    digitalWrite(STATUS_LED_PIN, LOW);
    delay(10);
    digitalWrite(STATUS_LED_PIN, HIGH);

    // Variables for parsing heading error and distance to waypoint
    float headingError = 0.0;
    float distanceMeters = 0.0;

    // Parse payload fields (Format: HEADING_ERROR:[err],DIST:[dist])
    char* errorPtr = strstr(packetBuffer, "HEADING_ERROR:");
    char* distPtr = strstr(packetBuffer, "DIST:");

    if (errorPtr != NULL && distPtr != NULL) {
      // Extract values using sscanf
      sscanf(errorPtr, "HEADING_ERROR:%f", &headingError);
      sscanf(distPtr, "DIST:%f", &distanceMeters);

      Serial.print("PARSED -> Error: ");
      Serial.print(headingError);
      Serial.print("° | Distance: ");
      Serial.print(distanceMeters);
      Serial.println(" meters");

      // Calculate Target Servo Angle (Proportional Autopilot loop)
      // e.g. headingError negative needs left steering, headingError positive needs right steering
      float rudderDeflection = headingError * STEERING_GAIN;
      
      // Compute final angle (Servo: 90 is center)
      int targetServoAngle = RUDDER_CENTER_ANGLE + (int)rudderDeflection;
      
      // Enforce physical constraints / bounds mapping
      targetServoAngle = constrain(targetServoAngle, RUDDER_MAX_LEFT, RUDDER_MAX_RIGHT);

      Serial.print("ACTUATOR -> Writing servo position: ");
      Serial.println(targetServoAngle);
      
      rudderServo.write(targetServoAngle);
      lastPacketTime = millis(); // Refresh watchdog register
    }
  }

  // Active Microcontroller Watchdog Safety Check
  // If we haven't received dynamic pilot signals recently, return the boat rudder to center to prevent runaway!
  if (millis() - lastPacketTime > WATCHDOG_TIMEOUT_MS) {
    rudderServo.write(RUDDER_CENTER_ANGLE);
    // Pulse status LED to warning sequence
    if ((millis() / 250) % 2 == 0) {
      digitalWrite(STATUS_LED_PIN, LOW);
    } else {
      digitalWrite(STATUS_LED_PIN, HIGH);
    }
  }
}
`
  },
  {
    name: "esp8266_motor_controller.ino",
    path: "firmware/esp8266_motor_controller.ino",
    language: "cpp",
    description: "Arduino C++ sketch using a DC Motor Controller (H-Bridge like L298N/L9110S) with NO positional encoder feedback. Translates heading error and proportional gain into directional pulse signals (PWM Duty Cycle + Dynamic Drive Timers) with integrated deadband guards and hard-stop safety limit counters to protect physical linkages.",
    code: `#include <ESP8266WiFi.h>
#include <WiFiUdp.h>

// Wi-Fi Access Point Credentials
const char* ap_ssid = "NavCore-Actuator-AP";
const char* ap_password = "actuator_secure_123";

// UDP Interface Configurations
const unsigned int localUdpPort = 4210; 
char packetBuffer[255]; 

WiFiUDP Udp;

// H-Bridge / DC Motor Controller Pin Configurations
const int PIN_MOTOR_PWM     = 5;  // GPIO5 (D1) Control speed of the actuator motor
const int PIN_MOTOR_DIR_A   = 4;  // GPIO4 (D2) Phase/Input A (High = forward/Left)
const int PIN_MOTOR_DIR_B   = 0;  // GPIO0 (D3) Phase/Input B (High = reverse/Right)
const int STATUS_LED_PIN    = 16; // GPIO16 (D0) Built-in status indication LED

// Calibration Parameters (Configured from the App UI calibration page via telemetry)
float steeringGainKp        = 12.5; // PWM steering gain multiplier (PWM duty per degree of error)
float deadbandDegrees       = 1.5;  // Ignore heading errors under this threshold to prevent motor chatter
float minDrivePwm           = 80.0; // Minimal torque to overcome physical friction (0-255 scale)
float maxDrivePwm           = 255.0;// Absolute speed ceiling for the drive motor

// Safety Limiters for Open-Loop Actuation
unsigned long lastPacketTime = 0;
const unsigned long UDP_WATCHDOG_TIMEOUT_MS = 2000; // Force stop if signals are lost for 2 seconds

// Since there is no encoder feedback, we integrate travel time to prevent motor binding at hard stops
unsigned long motorActiveStartTime = 0;
bool isMotorRunning = false;
const unsigned long MAX_SINGLE_DIR_TRAVEL_MS = 3500; // Limit continuous grinding in one direction
int lastDirection = 0; // 0 = Idle, -1 = Port, 1 = Starboard
unsigned long continuousDriveAccumulator = 0;

void setup() {
  Serial.begin(115200);
  delay(10);
  Serial.println("\\n--- NAVCORE MOTOR CONTROLLER START (NO ENCODER FEEDBACK) ---");

  // Output control pins
  pinMode(PIN_MOTOR_PWM, OUTPUT);
  pinMode(PIN_MOTOR_DIR_A, OUTPUT);
  pinMode(PIN_MOTOR_DIR_B, OUTPUT);
  pinMode(STATUS_LED_PIN, OUTPUT);

  // Default off state
  stopSteeringMotor();

  // Provision Access Point
  Serial.print("Initializing Access Point... ");
  WiFi.softAP(ap_ssid, ap_password);
  
  IPAddress localIP = WiFi.softAPIP();
  Serial.print("Created: ");
  Serial.println(localIP);

  // Initialize UDP socket
  Udp.begin(localUdpPort);
  Serial.print("Listening on Port: ");
  Serial.println(localUdpPort);

  digitalWrite(STATUS_LED_PIN, HIGH); // Off state (active low)
  lastPacketTime = millis();
}

void loop() {
  int packetSize = Udp.parsePacket();
  
  if (packetSize) {
    int len = Udp.read(packetBuffer, 255);
    if (len > 0) {
      packetBuffer[len] = '\\0';
    }

    Serial.print("RECV Datagram: ");
    Serial.println(packetBuffer);

    // Flash status LED on signal
    digitalWrite(STATUS_LED_PIN, LOW);
    
    float headingError = 0.0;
    float distanceMeters = 0.0;

    // Parse packet payload "HEADING_ERROR:[err],DIST:[dist]"
    char* errPtr = strstr(packetBuffer, "HEADING_ERROR:");
    char* distPtr = strstr(packetBuffer, "DIST:");

    if (errPtr != NULL && distPtr != NULL) {
      sscanf(errPtr, "HEADING_ERROR:%f", &headingError);
      sscanf(distPtr, "DIST:%f", &distanceMeters);

      Serial.print("PARSED -> Heading Error: ");
      Serial.print(headingError);
      Serial.print("° | Dist: ");
      Serial.println(distanceMeters);

      // Execute Open Loop steering logic
      processSteeringCommand(headingError);
      
      lastPacketTime = millis(); // Refresh watchdog register
    }
    
    digitalWrite(STATUS_LED_PIN, HIGH); // Turn Status LED off
  }

  // Watchdog Safety check for lost remote controls
  if (millis() - lastPacketTime > UDP_WATCHDOG_TIMEOUT_MS) {
    if (isMotorRunning) {
      Serial.println("SAFETY NOTICE: WATCHDOG TRIPPED. HALTING MOTORS.");
      stopSteeringMotor();
    }
    // Blink LED slowly to warn
    digitalWrite(STATUS_LED_PIN, (millis() / 500) % 2 == 0 ? LOW : HIGH);
  }
}

void processSteeringCommand(float error) {
  float absError = abs(error);

  // 1. Deadband threshold verification
  if (absError < deadbandDegrees) {
    Serial.println("DEADBAND ACTIVE: Rudder within range. Coasting.");
    stopSteeringMotor();
    return;
  }

  // 2. Compute proportional drive speed
  float rawPwm = minDrivePwm + (absError * steeringGainKp);
  int targetPwm = const_constraint(rawPwm, minDrivePwm, maxDrivePwm);

  // 3. Determine directional states
  int targetDirection = (error < 0) ? -1 : 1; // Negative error = Port, Positive error = Starboard

  // Check safety travel parameters to prevent mechanical burn out
  if (targetDirection == lastDirection && isMotorRunning) {
    unsigned long currentDuration = millis() - motorActiveStartTime;
    if (currentDuration > MAX_SINGLE_DIR_TRAVEL_MS) {
      Serial.println("WARNING: Actuator hit software maximum travel time limit! Stopping motor to protect linkages.");
      stopSteeringMotor();
      return;
    }
  } else {
    // Starting fresh motion or switching directions
    motorActiveStartTime = millis();
    lastDirection = targetDirection;
    isMotorRunning = true;
  }

  // 4. Actuate the H-bridge state
  if (targetDirection == -1) {
    // Steer Port
    digitalWrite(PIN_MOTOR_DIR_A, HIGH);
    digitalWrite(PIN_MOTOR_DIR_B, LOW);
    analogWrite(PIN_MOTOR_PWM, targetPwm);
    Serial.print("STEER PORT -> PWM Speed: ");
    Serial.println(targetPwm);
  } else {
    // Steer Starboard
    digitalWrite(PIN_MOTOR_DIR_A, LOW);
    digitalWrite(PIN_MOTOR_DIR_B, HIGH);
    analogWrite(PIN_MOTOR_PWM, targetPwm);
    Serial.print("STEER STARBOARD -> PWM Speed: ");
    Serial.println(targetPwm);
  }
}

void stopSteeringMotor() {
  digitalWrite(PIN_MOTOR_DIR_A, LOW);
  digitalWrite(PIN_MOTOR_DIR_B, LOW);
  analogWrite(PIN_MOTOR_PWM, 0);
  isMotorRunning = false;
  lastDirection = 0;
}

// Custom safety constrain wrapper
int const_constraint(float value, float posMin, float posMax) {
  if (value < posMin) return (int)posMin;
  if (value > posMax) return (int)posMax;
  return (int)value;
}
`
  }
];
