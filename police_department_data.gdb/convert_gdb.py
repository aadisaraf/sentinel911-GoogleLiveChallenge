import json
import os
import sys

# Instructions:
# 1. Install required libraries:
#    pip install geopandas fiona
# 2. Run this script in the root of the workspace:
#    python3 police_department_data/convert_gdb.py

try:
    import geopandas as gpd
except ImportError:
    print("Error: geopandas is not installed. Please install it using 'pip install geopandas'.")
    sys.exit(1)

# Configuration
GDB_PATH = 'police_department_data.gdb' 
OUTPUT_FILE = 'utils/policeStations.json'

def convert_gdb_to_json():
    print(f"Checking for GDB at: {GDB_PATH}")
    
    # Verify GDB path exists
    if not os.path.exists(GDB_PATH):
        print(f"Error: GDB path '{GDB_PATH}' not found.")
        return

    try:
        # List layers in the GDB
        import fiona
        layers = fiona.listlayers(GDB_PATH)
        print(f"Found layers: {layers}")
        
        # Heuristic: Find the layer that looks like 'Police' or 'Station'
        target_layer = None
        for layer in layers:
            if 'police' in layer.lower() or 'station' in layer.lower():
                target_layer = layer
                break
        
        if not target_layer and layers:
            target_layer = layers[0] # Default to first layer
            
        print(f"Reading layer: {target_layer}...")
        
        # Read the data using GeoPandas
        gdf = gpd.read_file(GDB_PATH, layer=target_layer)
        
        # Ensure we are in WGS84 (Lat/Lng)
        if gdf.crs and gdf.crs.to_string() != 'EPSG:4326':
            print("Reprojecting to EPSG:4326 (Lat/Lng)...")
            gdf = gdf.to_crs(epsg=4326)
            
        # Extract relevant fields and coordinates
        stations = []
        
        # Try to find common name columns
        name_cols = [c for c in gdf.columns if 'NAME' in c.upper() or 'DEPT' in c.upper()]
        addr_cols = [c for c in gdf.columns if 'ADD' in c.upper() or 'STREET' in c.upper()]
        id_cols = [c for c in gdf.columns if 'ID' in c.upper()]
        
        name_col = name_cols[0] if name_cols else gdf.columns[0]
        addr_col = addr_cols[0] if addr_cols else None
        id_col = id_cols[0] if id_cols else None
        
        print(f"Mapping columns - Name: {name_col}, Address: {addr_col}, ID: {id_col}")
        
        for idx, row in gdf.iterrows():
            if row.geometry.geom_type == 'Point':
                station = {
                    "id": str(row[id_col]) if id_col else str(idx),
                    "name": str(row[name_col]),
                    "lat": row.geometry.y,
                    "lng": row.geometry.x
                }
                if addr_col and row[addr_col]:
                    station["address"] = str(row[addr_col])
                
                stations.append(station)
                
        # Write to JSON
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(stations, f, indent=2)
            
        print(f"Successfully converted {len(stations)} stations to {OUTPUT_FILE}")
        print("Done.")
        
    except Exception as e:
        print(f"An error occurred: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    convert_gdb_to_json()
