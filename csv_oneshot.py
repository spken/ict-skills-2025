import pandas as pd
import mysql.connector
import pytz
import io
import re
import numpy as np

# --- CONFIG ---
CSV_FILE = "TODO"
DB_CONFIG = {
    "host": "localhost",
    "user": "root",
    "password": "ictskills",
    "database": "lawnmower_management"
}
LOCAL_TZ = pytz.timezone("Europe/Zurich")

# --- LOAD CSV ---
def preprocess_csv_content():
    """Preprocess CSV to fix unescaped commas in date fields."""
    with open(CSV_FILE, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Pattern to match date formats with commas that need to be quoted
    date_pattern = r'(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},\s+\d{4})'
    content = re.sub(date_pattern, r'"\1"', content)
    return content

# Get preprocessed content and load it
preprocessed_content = preprocess_csv_content()
df = pd.read_csv(io.StringIO(preprocessed_content))

print(f"Successfully loaded {len(df)} rows from CSV")
print(f"Unique lawnmowers (serial numbers): {df['SerialNumber'].nunique()}")

# --- CLEAN DATA ---
def clean_nan_values(df):
    """Clean all types of NaN values"""
    df = df.replace({np.nan: None})
    for col in df.columns:
        df[col] = df[col].replace({'nan': None, 'NaN': None, 'NaT': None, '': None})
        df.loc[df[col] == 'nan', col] = None
    return df

df = clean_nan_values(df)

# --- PROCESS DATES ---
def process_date_column(series, column_name):
    """Process a date column with multiple possible formats"""
    processed_dates = []
    
    for value in series:
        if value is None or pd.isna(value):
            processed_dates.append(None)
            continue
            
        try:
            parsed_date = pd.to_datetime(value, errors='coerce')
            if pd.isna(parsed_date):
                processed_dates.append(None)
            else:
                if parsed_date.tz is None:
                    parsed_date = parsed_date.tz_localize(LOCAL_TZ, nonexistent="shift_forward", ambiguous="NaT")
                parsed_date = parsed_date.tz_convert(pytz.UTC)
                formatted_date = parsed_date.strftime("%Y-%m-%d %H:%M:%S")
                processed_dates.append(formatted_date)
        except Exception as e:
            print(f"Error processing date '{value}' in column {column_name}: {e}")
            processed_dates.append(None)
    
    return processed_dates

# Process date columns
date_columns = ['PurchaseDate', 'LatestMaintenance', 'Timestamp']
for col in date_columns:
    if col in df.columns:
        print(f"Processing date column: {col}")
        df[col] = process_date_column(df[col], col)

# --- FINAL DATA CLEANUP ---
def final_cleanup(df):
    """Final cleanup to ensure no 'nan' strings remain"""
    for col in df.columns:
        mask = df[col].astype(str).str.lower() == 'nan'
        df.loc[mask, col] = None
        df[col] = df[col].replace('', None)
    return df

df = final_cleanup(df)
print("Data processing complete")

# --- SEPARATE UNIQUE LAWNMOWERS FROM TRACKING DATA ---
# Get unique lawnmowers (one per serial number, taking the first occurrence for static data)
lawnmower_columns = ['Name', 'AddressLine', 'PostalCode', 'City', 'Canton', 
                    'HomeLatitude', 'HomeLongitude', 'SerialNumber', 'Vendor', 
                    'Model', 'Firmware', 'PurchaseDate', 'LatestMaintenance', 'PortNumber']

unique_lawnmowers = df[lawnmower_columns].drop_duplicates(subset=['SerialNumber'], keep='first')
print(f"Found {len(unique_lawnmowers)} unique lawnmowers")

# Tracking data includes timestamp, GPS, battery, device state
tracking_data = df[['SerialNumber', 'Timestamp', 'Longitude', 'Latitude', 'DeviceState', 'BatteryLevel']].copy()
tracking_data = tracking_data.dropna(subset=['Timestamp'])  # Only keep rows with valid timestamps
print(f"Found {len(tracking_data)} tracking records")

# --- DB CONNECTION ---
conn = mysql.connector.connect(**DB_CONFIG)
cursor = conn.cursor()

try:
    conn.start_transaction()
    
    # --- INSERT UNIQUE LAWNMOWERS ---
    print("Inserting unique lawnmowers...")
    lawnmower_insert_count = 0
    
    for _, row in unique_lawnmowers.iterrows():
        try:
            cursor.execute("""
                INSERT INTO lawnmowers (
                    name, address, postal_code, city, canton, 
                    home_latitude, home_longitude, serial_number, 
                    vendor, model, firmware_version, purchase_date, 
                    latest_maintenance, port_number, timezone
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE 
                    name = VALUES(name),
                    address = VALUES(address),
                    latest_maintenance = VALUES(latest_maintenance),
                    updated_at = CURRENT_TIMESTAMP
            """, (
                row.get("Name"),
                row.get("AddressLine"),
                row.get("PostalCode"),
                row.get("City"),
                row.get("Canton"),
                row.get("HomeLatitude"),
                row.get("HomeLongitude"),
                row.get("SerialNumber"),
                row.get("Vendor"),
                row.get("Model"),
                row.get("Firmware"),
                row.get("PurchaseDate"),
                row.get("LatestMaintenance"),
                row.get("PortNumber"),
                "UTC"
            ))
            lawnmower_insert_count += 1
            
        except Exception as e:
            print(f"Error inserting lawnmower {row.get('SerialNumber')}: {e}")
            raise
    
    print(f"Successfully inserted/updated {lawnmower_insert_count} lawnmowers")
    
    # --- INSERT GPS TRACKING DATA ---
    print("Inserting GPS tracking data...")
    gps_insert_count = 0
    
    # First, get lawnmower IDs to link tracking data
    cursor.execute("SELECT id, serial_number FROM lawnmowers")
    lawnmower_map = {serial: id for id, serial in cursor.fetchall()}
    
    for _, row in tracking_data.iterrows():
        try:
            serial_number = row.get('SerialNumber')
            lawnmower_id = lawnmower_map.get(serial_number)
            
            if lawnmower_id:
                cursor.execute("""
                    INSERT INTO gps_positions (
                        lawnmower_id, timestamp, latitude, longitude
                    ) VALUES (%s, %s, %s, %s)
                """, (
                    lawnmower_id,
                    row.get('Timestamp'),
                    row.get('Latitude'),
                    row.get('Longitude')
                ))
                
                # Insert battery level if available
                if row.get('BatteryLevel') is not None:
                    cursor.execute("""
                        INSERT INTO battery_levels (
                            lawnmower_id, timestamp, battery_level
                        ) VALUES (%s, %s, %s)
                    """, (
                        lawnmower_id,
                        row.get('Timestamp'),
                        row.get('BatteryLevel')
                    ))
                
                # Insert device state if available
                if row.get('DeviceState') is not None:
                    cursor.execute("""
                        INSERT INTO device_states (
                            lawnmower_id, timestamp, state
                        ) VALUES (%s, %s, %s)
                    """, (
                        lawnmower_id,
                        row.get('Timestamp'),
                        row.get('DeviceState')
                    ))
                
                gps_insert_count += 1
                if gps_insert_count % 100 == 0:
                    print(f"Processed {gps_insert_count} tracking records...")
                    
        except Exception as e:
            print(f"Error inserting tracking data for {serial_number}: {e}")
            raise
    
    print(f"Successfully inserted {gps_insert_count} tracking records")
    
    # Commit the transaction
    conn.commit()
    print("SUCCESS! All data imported successfully!")
    print(f"Summary:")
    print(f"  - {lawnmower_insert_count} unique lawnmowers")
    print(f"  - {gps_insert_count} tracking records (GPS, battery, device state)")
    
except Exception as e:
    print(f"Error during import: {e}")
    conn.rollback()
    print("Transaction rolled back")
    
finally:
    cursor.close()
    conn.close()

print("Database connection closed. Script complete.")