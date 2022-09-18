var geometry = 
    /* color: #98ff00 */
    /* displayProperties: [
      {
        "type": "rectangle"
      }
    ] */
    ee.Geometry.Polygon(
        [[[10.248873281423245, 51.731097949812835],
          [10.248873281423245, 51.688763182880685],
          [10.417101430837308, 51.688763182880685],
          [10.417101430837308, 51.731097949812835]]], null, false);



var endDate = ee.Date(Date.now()).advance(-1, "month");

var observe_period = 90

var startDate = endDate.advance(-observe_period, "day");

var date_picker_start = endDate.advance(-5, "year");

var scale = 1000;
var go_sample = true;

    
function generate_collection(geometry, dataset, startDate, endDate) {
  
  var collection = ee.ImageCollection(dataset)
                .filterDate(startDate, endDate)
                .filterBounds(geometry);
  
  return collection
  
}

//the refresh function centers the map the to selected region
//collect different image collection

var geojson;

function refresh(geometry, startDate, endDate, scale, go_sample) {
  Map.centerObject(geometry);
  
  
  // NDVI and EVI
  var modis = generate_collection(geometry, 'MODIS/006/MOD13A1', startDate, endDate);
  
  var composite_image = modis.select(["NDVI", "EVI"]).reduce(ee.Reducer.mean()).divide(10000)
                              .multiply(100).round().divide(100);
  
  composite_image = composite_image.rename(["NDVI", "EVI"]);
  
  //Google Dynamic world
  
  var dw = generate_collection(geometry, 'GOOGLE/DYNAMICWORLD/V1', startDate, endDate)
                              .select('label');

  var label = dw.reduce(ee.Reducer.mode());
  
  label = label.rename(["Dynamic world LULC"]);

  composite_image = composite_image.addBands(label);
  
  //temperature
  //https://developers.google.com/earth-engine/datasets/catalog/JAXA_GCOM-C_L3_LAND_LST_V3#bands
  var temperature = generate_collection(geometry, 'JAXA/GCOM-C/L3/LAND/LST/V3', startDate, endDate)
                                        .filter(ee.Filter.eq("SATELLITE_DIRECTION", "D"))
                                        .select(['LST_AVE'])
                                        .reduce(ee.Reducer.mean())
                                        // Multiply with slope coefficient
                                        .multiply(0.02)
                                        .subtract(273.15)
                                        .multiply(100).round().divide(100);
  
  temperature = temperature.rename("Land surface temperature in °C");
                                      
  composite_image = composite_image.addBands(temperature);
                                        
  
  //precipitation
  var precipitation = generate_collection(geometry, 'ECMWF/ERA5_LAND/MONTHLY', startDate, endDate)
                                        .select(['total_precipitation'])
                                        
  precipitation = precipitation.reduce(ee.Reducer.mean()).multiply(1000).multiply(30)
                                .multiply(100).round().divide(100)
                              
  //print (precipitation)
  precipitation = precipitation.rename("Monthly precipitation in mm");
  
  composite_image = composite_image.addBands(precipitation);
  
  
  //elevation
  var elevation_image = ee.Image('NASA/NASADEM_HGT/001').select(["elevation"]);
  //var elevation_dataset = ee.Image('CGIAR/SRTM90_V4');
  
  elevation_image = elevation_image.rename(["Elevation in m"]);

  composite_image = composite_image.addBands(elevation_image);
  
  
  //methane
  //this dataset will map out some pixels, need to unmask
  //https://projects.iq.harvard.edu/files/acmg/files/intro_atmo_chem_bookchap1.pdf
  var methane = generate_collection(geometry, 'COPERNICUS/S5P/OFFL/L3_CH4', startDate, endDate)
                                        //.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
                                        .select(['CH4_column_volume_mixing_ratio_dry_air'])
                                        .reduce(ee.Reducer.mean())
                                        .multiply(100).round().divide(100)
                                        .unmask(null);
  methane = methane.rename("Methane ppb");
  
  composite_image = composite_image.addBands(methane);
  
  //productivity
  var productivity = generate_collection(geometry, 'MODIS/006/MOD17A2H', startDate, endDate)
                                        //.filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
                                        .select(['Gpp'])
                                        .reduce(ee.Reducer.mean())
                                        .multiply(100).round().divide(100)
                                        .unmask(null)
  productivity = productivity.rename("Gross primary productivity in kg C per square m per 16 days");
  
  composite_image = composite_image.addBands(productivity);
  
  
  //Leaf Area Index
  var leaf_area_index = generate_collection(geometry, 'JAXA/GCOM-C/L3/LAND/LAI/V3', startDate, endDate)
                                        .filter(ee.Filter.eq("SATELLITE_DIRECTION", "D"))
                                        .select(['LAI_AVE'])
                                        .reduce(ee.Reducer.mean())
                                        // Multiply with slope coefficient
                                        .multiply(0.001)
                                        .multiply(100).round().divide(100)
                                        ;
                                        
  leaf_area_index = leaf_area_index.rename("Leaf area index")
  
  composite_image = composite_image.addBands(leaf_area_index);

  
  //sampleRectangle will compress the whole area into one value
  if (go_sample === true) {
    geojson = composite_image.sample({"region": geometry, "scale": scale, "geometries": true})
  }
  else {
    var fcPoint = ee.FeatureCollection([
          ee.Feature(geometry)]);
          
    geojson = composite_image.sampleRegions({"collection": fcPoint, "scale": scale, "geometries": true})
  }
  
  
    
  geojson = geojson.map(function (feature) {
    var index_label = ee.Dictionary({
        0: "Water",
        1: "Trees",
        2: "Grass",
        3: "Flooded vegetation",
        4: "Crops",
        5: "Shrub and scrub",
        6: "Built",
        7: "Bare",
        8: "Snow and ice"
      });

    var index = feature.getNumber("Dynamic world LULC");
    return feature.set({"Dynamic world LULC": index_label.get(index)});
  })
  
  geojson = geojson.set("startDate", startDate, "endDate", endDate, "scale", scale)
  
  print (geojson)
  
  Map.addLayer(geojson);
}

//when the user redraw the region, refresh
Map.drawingTools().onDraw(function (new_geometry) {
  go_sample = true;
  geometry = new_geometry;
  urlLabel.style().set({shown: false});
  refresh(geometry, startDate, endDate, scale, go_sample);
})


var panel = ui.Panel({
    style: { width: '400px' }
  })

ui.root.add(panel);


panel.add(ui.Label({value: "To start, draw a region on the map or input your coordinates here", style: {width: '300px', fontSize: '30px', color: '484848'}}));

var coor_row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal')});
var coor_text = ui.Textbox({placeholder: "Lat, Long. e.g. 52.52, 13.405"});
coor_row.add(coor_text)

function geometry_update () {
  
  go_sample = false;
  
  var coor = ee.String(coor_text.getValue()).split(",")
  
  var lat = ee.Number.parse(coor.getString(0).trim()).getInfo()
  var long = ee.Number.parse(coor.getString(1).trim()).getInfo()
  
  var point = ee.Geometry({
  'type': 'Point',
  'coordinates':
    [long, lat]
  });
  
  Map.setCenter(long, lat);
  
  //var geometry = point.buffer({'distance': 5 * scale});
  urlLabel.style().set({shown: false});
  refresh(point, startDate, endDate, scale, go_sample);

}


var go_button = ui.Button({label: "Go", onClick: geometry_update});
coor_row.add(go_button);
panel.add(coor_row);


function date_update (dateRange) {
  startDate = dateRange.start()
  endDate = dateRange.end()
  urlLabel.style().set({shown: false});
  
  refresh(geometry, startDate, endDate, scale, go_sample);
}

function scale_update (new_scale) {
  scale = ee.Number.parse(new_scale);
  urlLabel.style().set({shown: false});
  refresh(geometry, startDate, endDate, scale, go_sample);
  
}


print (endDate)
print (endDate.advance(-observe_period, "day"))

panel.add(ui.Label({value: "Select a month", style: {width: '300px', fontSize: '30px', color: '484848'}}));
var start_date_picker = ui.DateSlider({start: date_picker_start, end: endDate, period: observe_period, onChange: date_update})
panel.add(start_date_picker);

panel.add(ui.Label({value: "Select a scale in m", style: {width: '300px', fontSize: '30px', color: '484848'}}));
var scale_selector = ui.Select({items: ["10", "100", "1000", "1e4", "1e5"], value: "1000", onChange: scale_update})
panel.add(scale_selector);



function export_data () {
  var url = geojson.getDownloadURL()
  print (url)
  urlLabel.setUrl(url);
  urlLabel.style().set({shown: true});
  //Export.table.toDrive({
  //  collection: geojson, 
  //  description: 'Convert', 
  //  fileNamePrefix: 'sample', 
  //  fileFormat: 'GeoJSON'
  //});
}

panel.add(ui.Label({value: "Download", style: {width: '300px', fontSize: '30px', color: '484848'}}));
var export_button = ui.Button({label: "Generate download link", onClick: export_data});
panel.add(export_button);

var urlLabel = ui.Label('Download', {shown: false});
panel.add(urlLabel);

  




